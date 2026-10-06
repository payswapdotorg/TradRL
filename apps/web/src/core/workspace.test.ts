// Tests for the workspace state machine — the pure heart of the console.
//
// Laws pinned here (workspace.ts header):
//   - one typed state, one event union, one TOTAL pure reducer;
//   - DETERMINISM: identical event sequences -> byte-identical states
//     (serializeWorkspace pins it — the Work Order demands this test);
//   - append-only + chain-verified history (tamper with any entry ->
//     verifyWorkspaceChain names the first broken seq);
//   - L12: every record entering the state passes the scope gate
//     (cross-tenant -> typed CrossTenantRenderError);
//   - section registry completeness (the twelve, selectable, default goal).

import { describe, expect, it } from 'vitest';
import type { ConstraintSetStatement, GatewaySubmissionRecord, GoalStatement, JobRecord, OrgStatusSnapshot, OutcomeRecord, PostMortemRecord, ProjectGoalWorldSpec, ProjectRecord, ServedKnowledge } from '../api/contracts';
import {
  CHAIN_ALGORITHM,
  CHAIN_FORMAT_VERSION,
  CHAIN_GENESIS,
  composeWorkspaceExport,
  openWorkspace,
  reduceAll,
  reduceWorkspace,
  serializeWorkspace,
  serializeWorkspaceExport,
  verifyWorkspaceChain,
  verifyWorkspaceExport,
  viewAtOf,
  watchEventsOf,
  type WorkspaceEvent,
  type WorkspaceState,
} from './workspace';
import { WORKSPACE_SECTIONS } from './sections';
import { CrossTenantRenderError } from './errors';
import { canonicalJson, sha256Hex, sha256Of } from './digest';
import { capsuleFromKnowledge, capsuleFromOutcome, capsuleFromPostMortem, capsuleFromSubmission, capsuleFromJob } from './evidence';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
const T0 = 1_700_000_000_000;

function projectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'proj-a',
    tenantId: 'tenant-a',
    name: 'Console Test Project',
    executionMode: 'simulation',
    lifecycle: { projectId: 'proj-a', status: 'active', acceptanceCriteriaId: null, organizationRef: null },
    lineage: { projectId: 'proj-a', createdAt: T0, createdBy: 'worker', priorVersion: null, version: 1 },
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  } as unknown as ProjectRecord;
}

function goalRecord(): GoalStatement {
  return {
    id: 'goal-1',
    version: 1,
    tenantId: 'tenant-a',
    objective: 'alpha over horizon',
    horizon: { startsAt: T0, endsAt: T0 + 86_400_000 },
    successCriteria: { criteria: [], requiredSatisfaction: 1 },
    evaluation: { blindRef: 'ev:blind', walkForwardRef: 'ev:wf', regimeRef: 'ev:regime', adversarialRequired: true },
    createdAt: T0,
  };
}

function orgSnapshot(status: 'forming' | 'active' = 'active'): OrgStatusSnapshot {
  return { organizationRef: 'org:alpha', tenant: 'tenant-a', project: 'proj-a', status, at: T0 + 10, instanceRefs: ['inst:1', 'inst:2'] };
}

/** A minimal constraint-set record (the goal-loaded pair's second half). */
function constraintSetRecord(): ConstraintSetStatement {
  return { id: 'cs-1', version: 1, tenantId: 'tenant-a', constraints: [], createdAt: T0 };
}

/** One persisted launch world (the host goal route's additive `world` field — D-8, W-28). */
function worldRecord(overrides: Partial<ProjectGoalWorldSpec> = {}): ProjectGoalWorldSpec {
  return {
    markets: ['BTC-USD', 'ETH-USD'],
    venues: ['binance', 'kraken'],
    dataSources: ['candle-v1', 'depth-v1'],
    executionMode: 'simulation',
    capitalBudget: '500000.00',
    riskBudget: '40000.00',
    horizon: { startsAt: T0, endsAt: T0 + 86_400_000 },
    ...overrides,
  };
}

function jobRecord(status: 'submitted' | 'running' | 'complete' | 'failed' = 'running'): JobRecord {
  return { jobId: 'job-1', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status, submittedAt: T0 + 20 };
}

function outcomeRecord(): OutcomeRecord {
  return {
    outcomeId: 'out-1',
    ordinal: 1,
    tenant: 'tenant-a',
    project: 'proj-a',
    decision: { decisionRef: 'dec-1', intentRef: 'int-1', disposition: 'filled' },
    outcomeClass: 'realized-profit',
    expectation: { expectedQuantity: '10', expectedRealized: '1.5', tolerance: '0.25', declaredBy: 'body-1' },
    realization: { filledQuantity: '10', realizedOutcome: '1.75', feeTotal: '0.02', notionalTotal: '1000.00', unrealizedAtDecision: '0.00' },
    deviation: { quantityShortfall: null, realizedGap: '0.25', withinTolerance: true },
    evidence: [{ kind: 'fill', ref: 'fil-1' }],
    lineage: { shadow: { fidelity: { mode: 'live' } } },
    asOf: T0 + 30,
    priorChainHead: '00000000',
  } as unknown as OutcomeRecord;
}

function knowledgeRecord(): ServedKnowledge {
  return {
    record: {
      knowledgeId: 'knl-1', ordinal: 1, tenant: 'tenant-a', project: 'proj-a',
      claim: { kind: 'causal', polarity: 'positive', dimension: 'momentum', lagBand: null },
      confidence: '0.80', evidenceCount: 3,
      provenance: { postMortemRefs: ['pm-1'], outcomeRefs: [], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: [] },
      validity: { from: T0, to: T0 + 1000 }, asOf: T0, priorChainHead: '00000000',
    },
    status: 'active', supersededBy: null,
  } as unknown as ServedKnowledge;
}

describe('workspace: opening + the twelve-section registry', () => {
  it('opens on the Goal section, connecting, empty data, live Time Machine, empty inbox', () => {
    const state = openWorkspace(SCOPE, T0);
    expect(state.scope).toEqual(SCOPE);
    expect(state.selectedSection).toBe('goal');
    expect(state.connection).toBe('connecting');
    expect(state.project).toBeNull();
    expect(state.jobs).toEqual([]);
    expect(state.inbox).toEqual({ notices: [], readNoticeIds: [] });
    expect(state.timeMachine.mode).toBe('live');
    expect(viewAtOf(state)).toBe(T0);
  });

  it('every one of the twelve sections is selectable (registry completeness)', () => {
    let state = openWorkspace(SCOPE, T0);
    for (const section of WORKSPACE_SECTIONS) {
      state = reduceWorkspace(state, { kind: 'section-selected', at: T0 + 1, section });
      expect(state.selectedSection).toBe(section);
    }
  });

  it('a non-section id is refused (the vocabulary is law)', () => {
    const state = openWorkspace(SCOPE, T0);
    expect(() => reduceWorkspace(state, { kind: 'section-selected', at: T0, section: 'misc' as never })).toThrow(/not a workspace section/);
  });

  it('opening requires a real scope and an integer instant', () => {
    expect(() => openWorkspace({ tenantId: '', projectId: 'p' }, T0)).toThrow(/scope/);
    expect(() => openWorkspace(SCOPE, 1.5)).toThrow(/integer/);
  });
});

describe('workspace: the persisted launch world (D-8, W-28 — the goal bundle\'s additive `world` field)', () => {
  it('goal-loaded WITH a world sets it; a later world-less goal-loaded (the demo scope, a pre-W-28 launch) CLEARS it — the state always mirrors THIS scope\'s read-back truth', () => {
    let state = openWorkspace(SCOPE, T0);
    expect(state.world).toBeNull(); // the fresh workspace carries no world
    state = reduceWorkspace(state, { kind: 'goal-loaded', at: T0 + 1, goal: goalRecord(), constraintSet: constraintSetRecord(), world: worldRecord() });
    expect(state.world).toEqual(worldRecord()); // the persisted launch world entered the state
    state = reduceWorkspace(state, { kind: 'goal-loaded', at: T0 + 2, goal: goalRecord(), constraintSet: constraintSetRecord() }); // NO world on the wire
    expect(state.world).toBeNull(); // the prior scope's world never survives a world-less read (no stale carry)
    // a re-read WITH a world restores it (the scope's own truth)
    state = reduceWorkspace(state, { kind: 'goal-loaded', at: T0 + 3, goal: goalRecord(), constraintSet: constraintSetRecord(), world: worldRecord({ markets: ['SOL-USD'] }) });
    expect(state.world?.markets).toEqual(['SOL-USD']);
  });

  it('the export carries the persisted world inside the workspace state block (D-14\'s world-spec gap, closed at the console\'s half)', () => {
    const state = reduceWorkspace(openWorkspace(SCOPE, T0), { kind: 'goal-loaded', at: T0 + 1, goal: goalRecord(), constraintSet: constraintSetRecord(), world: worldRecord() });
    const doc = composeWorkspaceExport(state);
    expect(doc.workspace.world).toEqual(worldRecord()); // the export's workspace.state block carries the world — reconstructable downstream
    const parsed = JSON.parse(serializeWorkspaceExport(state)) as { workspace: { world: unknown } };
    expect(parsed.workspace.world).toEqual(worldRecord()); // and it SURVIVES the serialized bytes
  });
});

describe('workspace: transitions', () => {
  it('connection-changed, project-loaded, org snapshot (dedup by ref+at), job upsert, notices refold', () => {
    let state = openWorkspace(SCOPE, T0);
    state = reduceWorkspace(state, { kind: 'connection-changed', at: T0 + 1, status: 'connected' });
    expect(state.connection).toBe('connected');

    state = reduceWorkspace(state, { kind: 'project-loaded', at: T0 + 2, project: projectRecord() });
    expect(state.project?.id).toBe('proj-a');

    state = reduceWorkspace(state, { kind: 'org-snapshot', at: T0 + 10, snapshot: orgSnapshot('active') });
    expect(state.orgSnapshots).toHaveLength(1);
    state = reduceWorkspace(state, { kind: 'org-snapshot', at: T0 + 10, snapshot: orgSnapshot('active') });
    expect(state.orgSnapshots).toHaveLength(1); // dedup: the same ref+at adds nothing

    state = reduceWorkspace(state, { kind: 'job-updated', at: T0 + 20, job: jobRecord('submitted') });
    state = reduceWorkspace(state, { kind: 'job-updated', at: T0 + 21, job: jobRecord('running') });
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0]?.status).toBe('running'); // upsert by jobId, not append

    // the active org snapshot folded exactly one organization_compiled notice
    expect(state.inbox.notices.map((n) => n.kind)).toEqual(['organization_compiled']);
  });

  it('goal-loaded carries the goal + constraint set', () => {
    let state = openWorkspace(SCOPE, T0);
    const goal = goalRecord();
    const constraintSet = { id: 'cs-1', version: 1, tenantId: 'tenant-a', constraints: [], createdAt: T0 };
    state = reduceWorkspace(state, { kind: 'goal-loaded', at: T0, goal, constraintSet });
    expect(state.goal?.id).toBe('goal-1');
    expect(state.constraintSet?.id).toBe('cs-1');
  });

  it('outcomes/knowledge/post-mortems load (scoped), degraded reads are retained (bounded 20) and flip the connection', () => {
    let state = openWorkspace(SCOPE, T0);
    state = reduceWorkspace(state, { kind: 'outcomes-loaded', at: T0 + 30, records: [outcomeRecord()] });
    expect(state.outcomes).toHaveLength(1);
    state = reduceWorkspace(state, { kind: 'knowledge-loaded', at: T0 + 31, records: [knowledgeRecord()] });
    expect(state.knowledge).toHaveLength(1);
    state = reduceWorkspace(state, { kind: 'post-mortems-loaded', at: T0 + 32, records: [{ postMortemId: 'pm-1', ordinal: 1, subject: { outcomeRecordRef: 'out-1', decisionRef: 'dec-1', intentRef: 'int-1', outcomeClass: 'realized-profit' }, expected: { expectedQuantity: null, expectedRealized: null, tolerance: '0.25' }, happened: { disposition: 'filled', filledQuantity: '10', realizedOutcome: '1.75', feeTotal: '0.02', notionalTotal: '1000.00' }, gap: { quantityShortfall: null, realizedGap: '0.25', withinTolerance: true }, hypotheses: [], evidence: [], lineage: { tenant: 'tenant-a', project: 'proj-a', shadowSessionRef: 'ss-1', shadowOutcomeRef: 'so-1', trajectoryRef: null, experiment: null }, asOf: T0 + 32, priorChainHead: '00000000' }] });
    expect(state.postMortems).toHaveLength(1);

    for (let index = 0; index < 25; index += 1) {
      state = reduceWorkspace(state, { kind: 'degraded-read', at: T0 + 100 + index, route: '/v1/jobs/x', family: 'jobs', message: 'timeout' });
    }
    expect(state.degraded).toHaveLength(20); // bounded retention
    expect(state.degraded[0]?.at).toBe(T0 + 105); // the NEWEST 20
    expect(state.connection).toBe('degraded');
  });

  it('project-adopted: the one scope transition (launchpad -> created project)', () => {
    const launchpad = openWorkspace({ tenantId: 'tenant-a', projectId: 'launchpad' }, T0);
    const adopted = reduceWorkspace(launchpad, { kind: 'project-adopted', at: T0 + 1, projectId: 'proj-new' });
    expect(adopted.scope.projectId).toBe('proj-new');
    // the loaded project record PINS the adoption: re-adopting the SAME project is an idempotent no-op
    const withProject = reduceWorkspace(adopted, { kind: 'project-loaded', at: T0 + 2, project: projectRecord({ id: 'proj-new', lifecycle: { projectId: 'proj-new', status: 'draft', acceptanceCriteriaId: null, organizationRef: null } }) });
    expect(reduceWorkspace(withProject, { kind: 'project-adopted', at: T0 + 4, projectId: 'proj-new' }).project?.id).toBe('proj-new'); // no record churn
    expect(reduceWorkspace(withProject, { kind: 'project-adopted', at: T0 + 4, projectId: 'proj-new' }).jobs).toHaveLength(0);
    // a DIFFERENT adoption supersedes (the launch bridge — see the SUPERSEDES pin: the deployed demo-scope boot launches a new organization)
    const superseded = reduceWorkspace(withProject, { kind: 'project-adopted', at: T0 + 3, projectId: 'proj-other' });
    expect(superseded.scope.projectId).toBe('proj-other');
    expect(superseded.project).toBeNull(); // the superseded project's records left
    // an empty adoption id is refused
    expect(() => reduceWorkspace(adopted, { kind: 'project-adopted', at: T0 + 5, projectId: '' })).toThrow(/project id/);
  });

  it('project-adopted SUPERSEDES a loaded project (the demo-boot launch — the deployed shell boots scoped to a real project, the launch adopts the created one)', () => {
    // THE LIVE J03 FINDING (W-12a, the production catalog): the deployed
    // shell boots scoped to prj-demo-console (TRADRL_CONSOLE_PROJECT_ID)
    // and the boot read cadence LOADS it; the launch's POST /v1/projects
    // 201 then adopts the CREATED project — the old law refused exactly
    // that ("the workspace already adopted project …; adopting … is a
    // typed input error") and the primary journey died at the error
    // card. The new law: the launch bridge adopts the created project
    // wherever the workspace was — the prior project's records LEAVE
    // the sections (the workspace is one project's world, R36/L12; the
    // append-only chain keeps everything).
    let state = openWorkspace({ tenantId: 'tenant-a', projectId: 'proj-a' }, T0);
    state = reduceWorkspace(state, { kind: 'project-loaded', at: T0 + 1, project: projectRecord({ lifecycle: { projectId: 'proj-a', status: 'active', acceptanceCriteriaId: null, organizationRef: 'org:demo' } }) });
    state = reduceWorkspace(state, { kind: 'goal-loaded', at: T0 + 1, goal: goalRecord(), constraintSet: constraintSetRecord(), world: worldRecord() });
    state = reduceWorkspace(state, { kind: 'org-snapshot', at: T0 + 2, snapshot: orgSnapshot() });
    state = reduceWorkspace(state, { kind: 'outcomes-loaded', at: T0 + 3, records: [outcomeRecord()] });
    state = reduceWorkspace(state, { kind: 'knowledge-loaded', at: T0 + 4, records: [knowledgeRecord()] });
    state = reduceWorkspace(state, { kind: 'job-updated', at: T0 + 5, job: jobRecord('complete') });
    expect(state.project?.id).toBe('proj-a'); // the deployed boot's loaded world
    expect(state.world).not.toBeNull(); // the loaded world rides the loaded goal (D-8, W-28)

    const adopted = reduceWorkspace(state, { kind: 'project-adopted', at: T0 + 6, projectId: 'proj-launched' });
    expect(adopted.scope.projectId).toBe('proj-launched'); // the workspace FOLLOWS the launch
    expect(adopted.project).toBeNull();                    // the prior project's records left the sections…
    expect(adopted.goal).toBeNull();
    expect(adopted.constraintSet).toBeNull();
    expect(adopted.world).toBeNull(); // D-8 (W-28): the prior project's world left with them (a scope switch never renders a foreign world)
    expect(adopted.orgSnapshots).toHaveLength(0);
    expect(adopted.outcomes).toHaveLength(0);
    expect(adopted.knowledge).toHaveLength(0);
    expect(adopted.jobs).toHaveLength(0);
    expect(adopted.postMortems).toHaveLength(0);
    expect(adopted.submissions).toHaveLength(0);
    expect(adopted.history.length).toBe(state.history.length + 1); // the append-only chain keeps everything
    expect(adopted.launch).toEqual(state.launch);                  // the launch slice survives its own adoption
    expect(adopted.inbox.notices.length).toBe(state.inbox.notices.length); // the session's folded notices stay (append-only history, never un-happened)

    // …and the L12 gate now treats the PRIOR project's records as foreign (a typed error, never a re-ingest)
    expect(() => reduceWorkspace(adopted, { kind: 'project-loaded', at: T0 + 7, project: projectRecord({ lifecycle: { projectId: 'proj-a', status: 'active', acceptanceCriteriaId: null, organizationRef: 'org:demo' } }) })).toThrow(CrossTenantRenderError);
    expect(() => reduceWorkspace(adopted, { kind: 'job-updated', at: T0 + 8, job: jobRecord('running') })).toThrow(CrossTenantRenderError);

    // the created project + its kickoff job load into the adopted scope (the submit path's own dispatches)
    let next = reduceWorkspace(adopted, { kind: 'project-loaded', at: T0 + 9, project: projectRecord({ id: 'proj-launched', lifecycle: { projectId: 'proj-launched', status: 'draft', acceptanceCriteriaId: null, organizationRef: null } }) });
    next = reduceWorkspace(next, { kind: 'job-updated', at: T0 + 10, job: { ...jobRecord('submitted'), project: 'proj-launched' } });
    expect(next.project?.id).toBe('proj-launched');
    expect(next.jobs).toHaveLength(1);
    expect(next.jobs[0]?.status).toBe('submitted');

    // re-adopting the NOW-LOADED created project is idempotent (no record churn)
    const reAdopted = reduceWorkspace(next, { kind: 'project-adopted', at: T0 + 11, projectId: 'proj-launched' });
    expect(reAdopted.project?.id).toBe('proj-launched');
    expect(reAdopted.jobs).toHaveLength(1);
  });

  it('anchor-advanced follows the observed now WITHOUT leaving the mode (the W-17a seam: the beat/launch cadence re-observes the live anchor — the v0.1.0 J03 release blocker)', () => {
    // THE LIVE FINDING (W-16's release acceptance): the LIVE view
    // instant stayed pinned at the BOOT instant for 4+ minutes while
    // wall-clock advanced — the console never re-observed the anchor
    // after boot (advanceAnchor only ran on the user's Time Machine
    // clicks), so every datum that became available after boot was
    // post-view-time and the L4 projection refused it (every launch
    // ended "Launch (failed)" on the typed AvailabilityViolationError).
    // The fix's event: the app observes a fresh injected instant on
    // the beat/launch cadence and the anchor follows it — the pure
    // machine's own transition, dispatched from the app layer.
    const opened = openWorkspace(SCOPE, T0);
    expect(viewAtOf(opened)).toBe(T0); // live at the boot anchor — the pin's premise

    const advanced = reduceWorkspace(opened, { kind: 'anchor-advanced', at: T0 + 240_000 }); // 4 minutes pass, the beat observes now
    expect(advanced.timeMachine.mode).toBe('live');  // the transition never leaves the mode
    expect(viewAtOf(advanced)).toBe(T0 + 240_000);   // LIVE renders the world as of NOW

    // the T-x offset rides the fresh anchor ("x before now" stays true as now advances)
    const tminus = reduceWorkspace(opened, { kind: 'view-tminus', at: T0 + 240_000, tMinusMs: 60_000 });
    const tminusAdvanced = reduceWorkspace(tminus, { kind: 'anchor-advanced', at: T0 + 300_000 });
    expect(tminusAdvanced.timeMachine.mode).toBe('t-minus');
    expect(viewAtOf(tminusAdvanced)).toBe(T0 + 240_000); // (T0 + 300_000) - 60_000

    // playback's ceiling RISES with the anchor: a tick that would have
    // passed the boot anchor passes the fresh one (the pure machine's
    // "never past the anchor" law is unchanged — the anchor itself moved)
    let playback = reduceWorkspace(opened, { kind: 'playback-start', at: T0, fromAt: T0 - 500, stepMs: 500 });
    playback = reduceWorkspace(playback, { kind: 'playback-tick', at: T0 }); // view = T0 (the boot anchor — the ceiling)
    expect(() => reduceWorkspace(playback, { kind: 'playback-tick', at: T0 })).toThrow(/after the anchor/); // the old ceiling holds
    const raised = reduceWorkspace(playback, { kind: 'anchor-advanced', at: T0 + 1_000 });
    const ticked = reduceWorkspace(raised, { kind: 'playback-tick', at: T0 + 1_000 }); // the raised ceiling lets the next step pass
    expect(viewAtOf(ticked)).toBe(T0 + 500);

    // the event chains onto the history like every event (append-only)
    expect(advanced.history.length).toBe(opened.history.length + 1);
  });

  it('launch events drive the launch slice (draft -> submitted -> progress -> completed)', () => {
    let state = openWorkspace(SCOPE, T0);
    state = reduceWorkspace(state, { kind: 'launch-draft-started', at: T0 + 1, draft: { name: 'x' } as never });
    expect(state.launch.phase).toBe('draft');
    state = reduceWorkspace(state, { kind: 'launch-submitted', at: T0 + 2, projectId: 'proj-a', jobId: 'job-9' });
    expect(state.launch.phase).toBe('launching');
    expect(state.launch.progress).toEqual([{ status: 'submitted', at: T0 + 2 }]);
    state = reduceWorkspace(state, { kind: 'launch-progress', at: T0 + 3, status: 'running' });
    state = reduceWorkspace(state, { kind: 'launch-completed', at: T0 + 4 });
    expect(state.launch.phase).toBe('launched');
    state = reduceWorkspace(state, { kind: 'launch-reset', at: T0 + 5 });
    expect(state.launch.phase).toBe('idle');
  });

  it('D-11 (W-29): the tracked launch\'s phase FOLLOWS ITS JOB\'S RECORD — a terminal job-updated closes the launch even with NO poll observation of the transition (the jobs-list race)', () => {
    // THE RACE (M4's finding: Home kept the "A launch is in progress"
    // banner after the launch completed; a second launch required a page
    // reload): app/console.ts dispatches launch-completed only from
    // pollJobs, and pollJobs SKIPS jobs already terminal in state — so
    // when the beat's jobs-list read serves the kickoff job ALREADY
    // complete (job-updated(complete) with no poll observation of the
    // transition), the dedicated event never fired and phase stayed
    // 'launching' forever. The reducer now closes the loop itself.
    let state = openWorkspace(SCOPE, T0);
    state = reduceWorkspace(state, { kind: 'launch-submitted', at: T0 + 2, projectId: 'proj-a', jobId: 'job-9' });
    expect(state.launch.phase).toBe('launching');
    // the jobs-list read serves the record already COMPLETE — no
    // launch-progress, no launch-completed anywhere in the sequence
    state = reduceWorkspace(state, { kind: 'job-updated', at: T0 + 3, job: { ...jobRecord('complete'), jobId: 'job-9' } });
    expect(state.launch.phase).toBe('launched');
    expect(state.launch.progress.map((point) => point.status)).toEqual(['submitted', 'complete']);
    // the poll path stays idempotent: the same terminal record again (a
    // re-read) appends its observation and changes the phase nothing
    state = reduceWorkspace(state, { kind: 'job-updated', at: T0 + 4, job: { ...jobRecord('complete'), jobId: 'job-9' } });
    expect(state.launch.phase).toBe('launched');
    // and the dedicated event on top of it changes nothing either
    state = reduceWorkspace(state, { kind: 'launch-completed', at: T0 + 5 });
    expect(state.launch.phase).toBe('launched');
  });

  it('D-11 (W-29): a tracked kickoff job FAILING through the record closes the launch with its error (and a NON-tracked job never touches the launch slice)', () => {
    let state = openWorkspace(SCOPE, T0);
    state = reduceWorkspace(state, { kind: 'launch-submitted', at: T0 + 2, projectId: 'proj-a', jobId: 'job-9' });
    // a different project's job completing must not close THIS launch
    state = reduceWorkspace(state, { kind: 'job-updated', at: T0 + 3, job: jobRecord('complete') });
    expect(state.launch.phase).toBe('launching'); // jobRecord's id is job-1, not the tracked job-9
    // the tracked job fails through its record (the list-read race again)
    state = reduceWorkspace(state, { kind: 'job-updated', at: T0 + 4, job: { ...jobRecord('failed'), jobId: 'job-9' } });
    expect(state.launch.phase).toBe('failed');
    expect(state.launch.error).toContain('job-9');
    // a concluded launch never re-opens on later records (the guard is the in-flight phase)
    state = reduceWorkspace(state, { kind: 'job-updated', at: T0 + 5, job: { ...jobRecord('complete'), jobId: 'job-9' } });
    expect(state.launch.phase).toBe('failed');
  });
});

describe('workspace: the L12 gate on every ingest', () => {
  it('a foreign tenant record is the typed CrossTenantRenderError, never ingested', () => {
    const state = openWorkspace(SCOPE, T0);
    const foreign = { ...projectRecord(), tenantId: 'tenant-b' };
    expect(() => reduceWorkspace(state, { kind: 'project-loaded', at: T0, project: foreign })).toThrow(CrossTenantRenderError);
    const foreignJob = { ...jobRecord(), tenant: 'tenant-b' };
    expect(() => reduceWorkspace(state, { kind: 'job-updated', at: T0, job: foreignJob })).toThrow(CrossTenantRenderError);
    const foreignOutcome = { ...outcomeRecord(), tenant: 'tenant-b' };
    expect(() => reduceWorkspace(state, { kind: 'outcomes-loaded', at: T0, records: [foreignOutcome] })).toThrow(CrossTenantRenderError);
    // the state itself is untouched (the reducer threw BEFORE mutating)
    expect(state.project).toBeNull();
  });
});

describe('workspace: DETERMINISM (the Work Order pin, demanded)', () => {
  const events: readonly WorkspaceEvent[] = [
    { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
    { kind: 'project-loaded', at: T0 + 2, project: projectRecord() },
    { kind: 'org-snapshot', at: T0 + 10, snapshot: orgSnapshot('active') },
    { kind: 'job-updated', at: T0 + 20, job: jobRecord('submitted') },
    { kind: 'job-updated', at: T0 + 21, job: jobRecord('complete') },
    { kind: 'outcomes-loaded', at: T0 + 30, records: [outcomeRecord()] },
    { kind: 'knowledge-loaded', at: T0 + 31, records: [knowledgeRecord()] },
    { kind: 'section-selected', at: T0 + 40, section: 'time-machine' },
    { kind: 'view-tminus', at: T0 + 41, tMinusMs: 5_000 },
    { kind: 'notice-read', at: T0 + 42, noticeId: 'ntc:deadbeef' },
    { kind: 'notices-read-all', at: T0 + 43 },
  ];

  it('identical event sequences -> byte-identical serialized states', () => {
    const first = serializeWorkspace(reduceAll(openWorkspace(SCOPE, T0), events));
    const second = serializeWorkspace(reduceAll(openWorkspace(SCOPE, T0), events));
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it('a different event sequence -> different bytes (the pin is not vacuous)', () => {
    const base = serializeWorkspace(reduceAll(openWorkspace(SCOPE, T0), events));
    const varied = serializeWorkspace(reduceAll(openWorkspace(SCOPE, T0), [...events, { kind: 'view-live', at: T0 + 99 }]));
    expect(varied).not.toBe(base);
  });
});

describe('workspace: the append-only chain-verified history', () => {
  it('every event links one entry; seq is 1-based and contiguous; the chain verifies; payloads are retained', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'org-snapshot', at: T0 + 10, snapshot: orgSnapshot() },
      { kind: 'job-updated', at: T0 + 20, job: jobRecord() },
    ]);
    expect(state.history.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(state.history.map((entry) => entry.kind)).toEqual(['connection-changed', 'org-snapshot', 'job-updated']);
    expect(state.history[0]?.tenantId).toBe('tenant-a');
    expect(state.history[0]?.chainHead).toMatch(/^[0-9a-f]{64}$/);
    // THE R9a LAW: every entry retains the exact event it was linked from
    expect(state.history[0]?.payload).toEqual({ kind: 'connection-changed', at: T0 + 1, status: 'connected' });
    expect(verifyWorkspaceChain(state.history)).toEqual({ ok: true });
  });

  it('tampering with any entry is detected (the FIRST broken seq is named)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'org-snapshot', at: T0 + 10, snapshot: orgSnapshot() },
      { kind: 'job-updated', at: T0 + 20, job: jobRecord() },
    ]);

    const wrongDigest = 'f'.repeat(64); // a well-formed 64-hex digest that is NOT entry 2's
    const tamperedDigest = state.history.map((entry, index) => (index === 1 ? { ...entry, digest: wrongDigest } : entry));
    const result = verifyWorkspaceChain(tamperedDigest);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.firstBrokenSeq).toBe(2);

    const third = state.history[2];
    if (third === undefined) throw new Error('fixture: the history must carry three entries');
    const tamperedSeq: typeof state.history = [...state.history.slice(0, 2), { ...third, seq: 9 }];
    const seqResult = verifyWorkspaceChain(tamperedSeq);
    expect(seqResult.ok).toBe(false);
    if (seqResult.ok === false) expect(seqResult.reason).toContain('seq');

    expect(verifyWorkspaceChain([])).toEqual({ ok: true });
  });

  it('a pre-v2 chain entry (the old 8-hex FNV form, no retained payload) is refused loudly, never silently accepted', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
    ]);
    const honest = state.history[0];
    if (honest === undefined) throw new Error('fixture: the history must carry one entry');
    // THE MIGRATION DECISION, pinned: the v1 form (an 8-hex digest over
    // an event that was NOT retained) is not verifiable and is never
    // accepted — the honest answer for pre-fix histories and exports.
    const v1Style = { ...honest, digest: 'deadbeef', payload: undefined } as unknown as typeof honest;
    const result = verifyWorkspaceChain([v1Style]);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toContain('64-hex');
  });
});

// ---------------------------------------------------------------------------
// R9a/R9b — EXPORT INTEGRITY (the chain is real; the export is complete)
// ---------------------------------------------------------------------------

/** A refused submission (the gateway's hard safety gate, L20). */
function refusedSubmission(): GatewaySubmissionRecord {
  return {
    kind: 'refused',
    submissionId: 'sub-1',
    decisionId: null,
    auditId: 'aud-1',
    refusal: { stage: 'risk' },
    refusedAt: T0 + 50,
  };
}

/** A routed submission (the gateway's own routed verdict). */
function routedSubmission(): GatewaySubmissionRecord {
  return {
    kind: 'routed',
    submissionId: 'sub-2',
    decisionId: 'dec-9',
    auditId: 'aud-2',
    requestRef: 'req-2',
    venue: 'venue-demo',
    adapterRef: 'ad-1',
    channelRef: 'ch-1',
    routedAt: T0 + 51,
  };
}

/** A post-mortem record. */
function postMortemRecord(): PostMortemRecord {
  return {
    postMortemId: 'pm-1', ordinal: 1,
    subject: { outcomeRecordRef: 'out-1', decisionRef: 'dec-1', intentRef: 'int-1', outcomeClass: 'realized-profit' },
    expected: { expectedQuantity: null, expectedRealized: null, tolerance: '0.25' },
    happened: { disposition: 'filled', filledQuantity: '10', realizedOutcome: '1.75', feeTotal: '0.02', notionalTotal: '1000.00' },
    gap: { quantityShortfall: null, realizedGap: '0.25', withinTolerance: true },
    hypotheses: [{ hypothesisClass: 'regime-shift' }],
    evidence: [{ kind: 'fill', ref: 'fil-1' }],
    lineage: { tenant: 'tenant-a', project: 'proj-a', shadowSessionRef: 'ss-1', shadowOutcomeRef: 'so-1', trajectoryRef: null, experiment: null },
    asOf: T0 + 32, priorChainHead: '00000000',
  } as unknown as PostMortemRecord;
}

/** THE RICH FIXTURE: every collection populated, notices folded, one read. */
function richState(): WorkspaceState {
  let state = openWorkspace(SCOPE, T0);
  state = reduceWorkspace(state, { kind: 'connection-changed', at: T0 + 1, status: 'connected' });
  state = reduceWorkspace(state, { kind: 'project-loaded', at: T0 + 2, project: projectRecord() });
  state = reduceWorkspace(state, { kind: 'goal-loaded', at: T0 + 3, goal: goalRecord(), constraintSet: { id: 'cs-1', version: 1, tenantId: 'tenant-a', constraints: [], createdAt: T0 } });
  state = reduceWorkspace(state, { kind: 'org-snapshot', at: T0 + 10, snapshot: orgSnapshot('active') });
  state = reduceWorkspace(state, { kind: 'job-updated', at: T0 + 20, job: jobRecord('complete') });
  state = reduceWorkspace(state, { kind: 'outcomes-loaded', at: T0 + 30, records: [outcomeRecord()] });
  state = reduceWorkspace(state, { kind: 'knowledge-loaded', at: T0 + 31, records: [knowledgeRecord()] });
  state = reduceWorkspace(state, { kind: 'post-mortems-loaded', at: T0 + 32, records: [postMortemRecord()] });
  state = reduceWorkspace(state, { kind: 'submission-recorded', at: T0 + 50, submission: refusedSubmission() });
  state = reduceWorkspace(state, { kind: 'submission-recorded', at: T0 + 51, submission: routedSubmission() });
  const firstNotice = state.inbox.notices[0];
  if (firstNotice === undefined) throw new Error('fixture: the fold must have produced notices');
  state = reduceWorkspace(state, { kind: 'notice-read', at: T0 + 60, noticeId: firstNotice.noticeId });
  state = reduceWorkspace(state, { kind: 'section-selected', at: T0 + 61, section: 'time-machine' });
  state = reduceWorkspace(state, { kind: 'view-tminus', at: T0 + 62, tMinusMs: 5_000 });
  return state;
}

/** Parse the exported bytes back (the auditor's position: the FILE, nothing else). */
function exportedDoc(state: WorkspaceState): Record<string, unknown> {
  return JSON.parse(serializeWorkspaceExport(state)) as Record<string, unknown>;
}

describe('workspace: the SHA-256 chain (R9a — genesis + linkage under the published rules)', () => {
  it('every digest and link recomputes from the PUBLISHED rules alone (sha256Of + canonicalJson, no workspace helpers)', () => {
    const state = richState();
    let priorHead = CHAIN_GENESIS;
    for (const entry of state.history) {
      // The published digest rule, applied independently by this test:
      const digest = sha256Of({ seq: entry.seq, tenantId: entry.tenantId, projectId: entry.projectId, payload: entry.payload });
      expect(digest).toBe(entry.digest);
      // The published link rule, applied independently by this test:
      const chainHead = sha256Hex(priorHead + digest);
      expect(chainHead).toBe(entry.chainHead);
      priorHead = chainHead;
    }
  });

  it('the first entry links to the DOCUMENTED GENESIS (64 zero hex chars), not to a placeholder', () => {
    const state = richState();
    const first = state.history[0];
    if (first === undefined) throw new Error('fixture: the history must not be empty');
    expect(CHAIN_GENESIS).toMatch(/^0{64}$/);
    expect(first.chainHead).toBe(sha256Hex(CHAIN_GENESIS + first.digest));
    // and the chain is a chain: entry 2's head depends on entry 1's head
    const second = state.history[1];
    if (second === undefined) throw new Error('fixture: the history must carry a second entry');
    expect(second.chainHead).toBe(sha256Hex((first.chainHead as string) + (second.digest as string)));
  });

  it('the runtime chain and the export-rebuilt chain AGREE entry for entry (one algorithm, both places)', () => {
    const state = richState();
    const doc = composeWorkspaceExport(state);
    expect(doc.events.length).toBe(state.history.length);
    for (let index = 0; index < state.history.length; index++) {
      const runtime = state.history[index];
      const exported = doc.events[index];
      if (runtime === undefined || exported === undefined) throw new Error('fixture: histories must align');
      expect(exported.digest).toBe(runtime.digest);
      expect(exported.chainHead).toBe(runtime.chainHead);
      expect(exported.payload).toEqual(runtime.payload);
    }
    expect(doc.chain.head).toBe((state.history[state.history.length - 1] as { chainHead: string }).chainHead);
  });

  it('a payload-less history entry is a LOUD composition error (never a fake digest over nothing)', () => {
    const state = richState();
    const broken = { ...(state.history[0] as { seq: number }), tenantId: 'tenant-a', projectId: 'proj-a', at: T0, kind: 'connection-changed', digest: '0'.repeat(64), chainHead: '0'.repeat(64), payload: undefined } as unknown as WorkspaceState['history'][number];
    const brokenState = { ...state, history: [broken] };
    expect(() => composeWorkspaceExport(brokenState)).toThrow(/retains no payload/);
  });
});

describe('workspace: export derivability + tamper detection (R9a — the file alone is enough)', () => {
  it('an honest export verifies END TO END from its own bytes', () => {
    const state = richState();
    const bytes = serializeWorkspaceExport(state);
    const parsed = JSON.parse(bytes);
    expect(verifyWorkspaceExport(parsed)).toEqual({ ok: true });
  });

  it('an empty workspace exports and verifies (genesis head, zero events)', () => {
    const state = openWorkspace(SCOPE, T0);
    const doc = composeWorkspaceExport(state);
    expect(doc.events).toEqual([]);
    expect(doc.chain.entryCount).toBe(0);
    expect(doc.chain.head).toBe(CHAIN_GENESIS);
    expect(verifyWorkspaceExport(JSON.parse(serializeWorkspaceExport(state)))).toEqual({ ok: true });
  });

  it('every digest and link recomputes from the FILE alone (the auditor recomputes with the published rules)', () => {
    const doc = exportedDoc(richState());
    const events = doc.events as Array<Record<string, unknown>>;
    expect(events.length).toBeGreaterThan(3);
    let priorHead = CHAIN_GENESIS;
    for (const entry of events) {
      const digest = sha256Of({ seq: entry.seq, tenantId: entry.tenantId, projectId: entry.projectId, payload: entry.payload });
      expect(digest).toBe(entry.digest);
      expect(sha256Hex(priorHead + digest)).toBe(entry.chainHead);
      priorHead = entry.chainHead as string;
    }
    const chain = doc.chain as Record<string, unknown>;
    expect(chain.head).toBe(priorHead);
    expect(chain.entryCount).toBe(events.length);
  });

  it('TAMPERING any field class breaks verification (each class named)', () => {
    const doc = exportedDoc(richState());
    const events = doc.events as Array<Record<string, unknown>>;
    const chain = doc.chain as Record<string, unknown>;
    const scope = doc.scope as Record<string, unknown>;

    const expectBroken = (tampered: unknown, reasonNeedle: string) => {
      const result = verifyWorkspaceExport(tampered);
      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.reason).toContain(reasonNeedle);
    };
    const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    const eventsOf = (d: Record<string, unknown>): Array<Record<string, unknown>> => d.events as Array<Record<string, unknown>>;

    // payload.at — a timestamp field of the event's payload
    const atTampered = clone();
    ((eventsOf(atTampered)[1] as Record<string, unknown>).payload as Record<string, unknown>).at = T0 + 999;
    expectBroken(atTampered, 'digest does not match');

    // payload.kind — the event-kind field
    const kindTampered = clone();
    ((eventsOf(kindTampered)[1] as Record<string, unknown>).payload as Record<string, unknown>).kind = 'launch-completed';
    expectBroken(kindTampered, 'digest does not match');

    // a nested payload DATA field (the job's own id inside a job-updated event)
    const dataTampered = clone();
    for (const entry of eventsOf(dataTampered)) {
      const payload = entry.payload as Record<string, unknown>;
      if (payload.kind === 'job-updated') {
        (payload.job as Record<string, unknown>).jobId = 'job-forged';
      }
    }
    expectBroken(dataTampered, 'digest does not match');

    // entry.seq (continuity) and entry swap (reorder)
    const seqTampered = clone();
    (eventsOf(seqTampered)[2] as Record<string, unknown>).seq = 9;
    expectBroken(seqTampered, 'seq');
    const swapped = clone();
    const swappedEvents = eventsOf(swapped);
    const third = swappedEvents[2] as Record<string, unknown>;
    swappedEvents[2] = swappedEvents[3] as Record<string, unknown>;
    swappedEvents[3] = third;
    expectBroken(swapped, 'seq');

    // entry.tenantId (the export's own tenant) and entry.projectId (inside the digest input)
    const tenantTampered = clone();
    (eventsOf(tenantTampered)[1] as Record<string, unknown>).tenantId = 'tenant-b';
    expectBroken(tenantTampered, 'tenant');
    const projectTampered = clone();
    (eventsOf(projectTampered)[1] as Record<string, unknown>).projectId = 'proj-forged';
    expectBroken(projectTampered, 'digest does not match');

    // digest (well-formed 64-hex but wrong) and chainHead
    const digestTampered = clone();
    (eventsOf(digestTampered)[1] as Record<string, unknown>).digest = 'f'.repeat(64);
    expectBroken(digestTampered, 'does not match');
    const headTampered = clone();
    (eventsOf(headTampered)[1] as Record<string, unknown>).chainHead = 'e'.repeat(64);
    expectBroken(headTampered, 'does not link');

    // entry REMOVAL (last: descriptor counts/head; middle: seq gap)
    const lastRemoved = clone();
    eventsOf(lastRemoved).pop();
    expectBroken(lastRemoved, 'counts');
    const middleRemoved = clone();
    eventsOf(middleRemoved).splice(1, 1);
    expectBroken(middleRemoved, 'seq');

    // the chain descriptor itself
    const algorithmTampered = clone();
    ((algorithmTampered.chain as Record<string, unknown>).algorithm as string) = 'fnv-1a';
    expectBroken(algorithmTampered, 'algorithm');
    const genesisTampered = clone();
    (genesisTampered.chain as Record<string, unknown>).genesis = '00000000';
    expectBroken(genesisTampered, 'genesis');
    const headFieldTampered = clone();
    (headFieldTampered.chain as Record<string, unknown>).head = 'd'.repeat(64);
    expectBroken(headFieldTampered, 'chain head');
    const countTampered = clone();
    (countTampered.chain as Record<string, unknown>).entryCount = 1;
    expectBroken(countTampered, 'counts');

    // the document envelope
    const formatTampered = clone();
    formatTampered.format = 'tradrl-workspace';
    expectBroken(formatTampered, 'format');
    const versionTampered = clone();
    versionTampered.formatVersion = 1;
    expectBroken(versionTampered, 'format version');
    const scopeTampered = clone();
    (scopeTampered.scope as Record<string, unknown>).tenantId = 'tenant-b';
    expectBroken(scopeTampered, 'tenant');

    // and the honest file still verifies after all of that
    expect(verifyWorkspaceExport(doc)).toEqual({ ok: true });
    expect(scope.tenantId).toBe('tenant-a'); // (the fixture held)
    expect(chain.algorithm).toBe('sha-256');
    expect(events.length).toBe(13);
  });

  it('a pre-fix v1 export (the old serializeWorkspace dump) does not verify — honestly refused, never faked', () => {
    // The v1 form: a bare state dump whose history carried 8-hex
    // digests of events that were never retained. This test pins the
    // honest boundary: those files cannot be upgraded after the fact.
    const state = richState();
    const v1Bytes = serializeWorkspace(state);
    const v1Doc = JSON.parse(v1Bytes);
    const result = verifyWorkspaceExport(v1Doc);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toContain('format');
  });
});

describe('workspace: export completeness (R9b — capsules, decisions, read-state)', () => {
  it('the export carries the EVIDENCE CAPSULES (every source family, the Evidence section\'s own derivations)', () => {
    const state = richState();
    const doc = composeWorkspaceExport(state);
    const expected = [
      capsuleFromOutcome(SCOPE, state.outcomes[0] as OutcomeRecord),
      capsuleFromPostMortem(SCOPE, state.postMortems[0] as PostMortemRecord),
      capsuleFromKnowledge(SCOPE, state.knowledge[0] as ServedKnowledge),
      capsuleFromSubmission(SCOPE, state.submissions[0] as GatewaySubmissionRecord),
      capsuleFromSubmission(SCOPE, state.submissions[1] as GatewaySubmissionRecord),
    ];
    expect(doc.capsules).toEqual(expected);
    expect(doc.capsules.length).toBe(5); // 1 outcome + 1 post-mortem + 1 knowledge + 2 submissions
    for (const capsule of doc.capsules) {
      expect(capsule.capsuleId).toMatch(/^evc:[0-9a-f]{8}$/); // content-addressed, derivable from the capsule's own content
    }
  });

  it('D-9 (W-28): the export carries the JOB capsules too — one per COMPLETED job WITH a result, never for a resultless one; a re-read mints no duplicate', () => {
    // richState's own job is 'complete' WITHOUT a result — it mints nothing
    // (the fixture's pinned 5-capsule list above stays true unchanged).
    const state = richState();
    expect((state.jobs[0] as JobRecord).status).toBe('complete');
    expect((state.jobs[0] as JobRecord).result).toBeUndefined();
    // the completed job WITH a result: the research result mints its capsule
    const resultJob: JobRecord = {
      jobId: 'job-result-1', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'complete',
      submittedAt: T0 + 20, completedAt: T0 + 25,
      result: { kind: 'release-candidate', specId: 'spec-demo-director', version: 1, project: 'proj-a' },
    };
    const withResult = reduceWorkspace(state, { kind: 'job-updated', at: T0 + 26, job: resultJob });
    const doc = composeWorkspaceExport(withResult);
    expect(doc.capsules.length).toBe(6); // the 5 read-family capsules + the job capsule
    const jobCapsule = capsuleFromJob(SCOPE, resultJob);
    expect(doc.capsules).toContainEqual(jobCapsule); // the lineage leg: a capsule that references its job
    expect(doc.capsules[5]?.refs).toEqual([{ kind: 'job', ref: 'job-result-1' }]);
    expect(doc.manifest.counts.capsules).toBe(6); // the manifest stays TRUE (self-describing completeness)
    // the fold is IDEMPOTENT under re-reads: the reducer's replace-by-id
    // merge keeps the listing deduped, and the content address derives the
    // identical capsule — a hydration replay or a re-read mints no duplicate.
    const reRead = reduceWorkspace(withResult, { kind: 'job-updated', at: T0 + 27, job: { ...resultJob } });
    expect(reRead.jobs.filter((job) => job.jobId === 'job-result-1')).toHaveLength(1);
    expect(composeWorkspaceExport(reRead).capsules.length).toBe(6);
    expect(composeWorkspaceExport(reRead).capsules).toContainEqual(jobCapsule);
  });

  it('the export carries the DECISIONS (the watch records + the gateway\'s own records, exactly as the Decisions section renders)', () => {
    const state = richState();
    const doc = composeWorkspaceExport(state);
    expect(doc.decisions.watch).toEqual(watchEventsOf(state));
    expect(doc.decisions.watch.length).toBe(7); // 2 org instances + 1 job + 1 outcome + 1 post-mortem + 2 submissions
    expect(doc.decisions.gateway).toEqual(state.submissions);
    expect(doc.decisions.gateway.length).toBe(2);
    // every watch record carries a decision (the seven-lens shape the section renders)
    for (const event of doc.decisions.watch) {
      expect(event.decision).not.toBeNull();
    }
  });

  it('the export carries the READ-STATE (read + unread notice ids, first-class)', () => {
    const state = richState();
    const doc = composeWorkspaceExport(state);
    expect(state.inbox.notices.length).toBe(2); // organization_compiled + safety_intervention
    const readNotice = state.inbox.notices[0];
    const unreadNotice = state.inbox.notices[1];
    if (readNotice === undefined || unreadNotice === undefined) throw new Error('fixture: two notices required');
    expect(doc.readState.readNoticeIds).toEqual([readNotice.noticeId]);
    expect(doc.readState.unreadNoticeIds).toEqual([unreadNotice.noticeId]);
    expect(doc.workspace.inbox).toEqual(state.inbox); // the inbox itself stays in the state block
  });

  it('the manifest is self-describing and TRUE (every included block exists; every count matches)', () => {
    const state = richState();
    const doc = composeWorkspaceExport(state);
    expect(doc.manifest.included).toEqual([
      'workspace.state', 'events.chain', 'evidence.capsules', 'decisions.watch', 'decisions.gateway', 'readState',
    ]);
    expect(doc.manifest.counts.events).toBe(doc.events.length);
    expect(doc.manifest.counts.capsules).toBe(doc.capsules.length);
    expect(doc.manifest.counts.decisionsWatch).toBe(doc.decisions.watch.length);
    expect(doc.manifest.counts.decisionsGateway).toBe(doc.decisions.gateway.length);
    expect(doc.manifest.counts.notices).toBe(state.inbox.notices.length);
    expect(doc.manifest.counts.readNotices).toBe(doc.readState.readNoticeIds.length);
    expect(doc.manifest.counts.unreadNotices).toBe(doc.readState.unreadNoticeIds.length);
    expect(doc.format).toBe('tradrl-workspace-export');
    expect(doc.formatVersion).toBe(2);
    expect(doc.chain.algorithm).toBe(CHAIN_ALGORITHM);
    expect(doc.chain.version).toBe(CHAIN_FORMAT_VERSION);
    expect(doc.chain.genesis).toBe(CHAIN_GENESIS);
    expect(doc.chain.digestRule).toContain('sha256Hex(canonicalJson');
    expect(doc.chain.linkRule).toContain('previousChainHead + digest');
  });

  it('the workspace block carries EVERYTHING but the history (which IS the events chain)', () => {
    const state = richState();
    const doc = composeWorkspaceExport(state);
    expect((doc.workspace as Record<string, unknown>).history).toBeUndefined();
    expect(doc.workspace.scope).toEqual(state.scope);
    expect(doc.workspace.project).toEqual(state.project);
    expect(doc.workspace.jobs).toEqual(state.jobs);
    expect(doc.workspace.outcomes).toEqual(state.outcomes);
    expect(doc.workspace.postMortems).toEqual(state.postMortems);
    expect(doc.workspace.knowledge).toEqual(state.knowledge);
    expect(doc.workspace.submissions).toEqual(state.submissions);
    expect(doc.workspace.timeMachine).toEqual(state.timeMachine);
    expect(doc.workspace.inbox).toEqual(state.inbox);
  });
});

describe('workspace: export DETERMINISM (the law extends to the export bytes)', () => {
  it('identical states -> byte-identical export documents', () => {
    const first = serializeWorkspaceExport(richState());
    const second = serializeWorkspaceExport(richState());
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it('a different state -> different export bytes (the pin is not vacuous)', () => {
    const base = serializeWorkspaceExport(richState());
    const varied = serializeWorkspaceExport(reduceWorkspace(richState(), { kind: 'view-live', at: T0 + 99 }));
    expect(varied).not.toBe(base);
  });
});
