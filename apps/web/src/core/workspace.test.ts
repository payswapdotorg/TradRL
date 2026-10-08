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
  CHAIN_CANONICAL_RULE,
  CHAIN_DIGEST_RULE,
  CHAIN_FORMAT_VERSION,
  CHAIN_GENESIS,
  composeWorkspaceExport,
  earliestRecordInstantOf,
  historyFloorOf,
  openWorkspace,
  reduceAll,
  reduceWorkspace,
  serializeWorkspace,
  serializeWorkspaceExport,
  verifyWorkspaceChain,
  verifyWorkspaceExport,
  verifyWorkspaceExportReport,
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
      'launchWorld', 'workspace.state', 'events.chain', 'evidence.capsules', 'decisions.watch', 'decisions.gateway', 'readState',
    ]);
    expect(doc.manifest.counts.launchWorld).toBe(doc.launchWorld === null ? 0 : 1); // D-14: the world count is TRUE either way
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
    // D-14: richState's chain is single-project — no cross-scope note to disclose
    expect(doc.manifest.chainScopeNote).toBeUndefined();
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

// ---------------------------------------------------------------------------
// D-14 (W-29) — THE EXPORT'S SUBSTANCE: the launch WORLD specification,
// first-class, and the chain-scope audit note. L5's P19 finding: the world
// spec (markets/venues/dataSources) was NOWHERE in the export file (the
// goal object carries no world fields, launch.draft was null) — the launch
// config was unrecoverable downstream; and L1/L2/L5 noted the events chain
// legitimately spans projects under a project-scoped export label with
// every entry self-labeling its projectId and integrity unaffected — a span
// an audit pack must DISCLOSE, not hide. Both additions are ADDITIVE: the
// format version stays 2 and v2 readers that do not know the fields verify
// the document unchanged.
// ---------------------------------------------------------------------------

describe('workspace: D-14 — the export carries the launch WORLD, first-class (additive)', () => {
  it('a scope WITH a world exports it as the document\'s own launchWorld field — the full specification, byte-true, surviving the serialized bytes', () => {
    let state = reduceWorkspace(openWorkspace(SCOPE, T0), { kind: 'goal-loaded', at: T0 + 1, goal: goalRecord(), constraintSet: constraintSetRecord(), world: worldRecord({ markets: ['BTC-USD', 'ETH-USD', 'SOL-USD'], venues: ['binance', 'kraken'], dataSources: ['candle-v1', 'depth-v1', 'trades-v1'] }) });
    state = reduceWorkspace(state, { kind: 'view-live', at: T0 + 2 }); // one chained event, so the export is non-trivial
    const doc = composeWorkspaceExport(state);
    expect(doc.launchWorld).toEqual(worldRecord({ markets: ['BTC-USD', 'ETH-USD', 'SOL-USD'], venues: ['binance', 'kraken'], dataSources: ['candle-v1', 'depth-v1', 'trades-v1'] }));
    expect(doc.launchWorld?.markets).toEqual(['BTC-USD', 'ETH-USD', 'SOL-USD']); // the markets
    expect(doc.launchWorld?.venues).toEqual(['binance', 'kraken']);               // the venues
    expect(doc.launchWorld?.dataSources).toEqual(['candle-v1', 'depth-v1', 'trades-v1']); // the data sources
    expect(doc.manifest.included).toContain('launchWorld');       // the manifest DECLARES it
    expect(doc.manifest.counts.launchWorld).toBe(1);              // and counts it TRUE
    // the serialized bytes carry it (the downloaded file is what downstream holds)
    const parsed = exportedDoc(state);
    expect(parsed.launchWorld).toEqual(doc.launchWorld);
    // the goal statement itself stays the frozen served shape — the world rides its own sibling field
    expect((parsed.workspace as Record<string, unknown>).world).toEqual(doc.launchWorld); // the state block keeps its own copy (W-28)
  });

  it('a scope with NO world on record (the demo scope — its seeded goal carries no world fields) exports launchWorld: null with the manifest count TRUE at 0 — the honest absence, never a fabricated world', () => {
    const state = reduceWorkspace(openWorkspace(SCOPE, T0), { kind: 'view-live', at: T0 + 1 });
    const doc = composeWorkspaceExport(state);
    expect(doc.launchWorld).toBeNull();
    expect(doc.manifest.counts.launchWorld).toBe(0);
    expect(exportedDoc(state).launchWorld).toBeNull(); // survives the bytes
  });

  it('the additions are ADDITIVE for v2 readers: a document carrying launchWorld + chainScopeNote verifies END TO END, and one WITHOUT them verifies too (the format version stays 2)', () => {
    const withWorld = reduceWorkspace(openWorkspace(SCOPE, T0), { kind: 'goal-loaded', at: T0 + 1, goal: goalRecord(), constraintSet: constraintSetRecord(), world: worldRecord() });
    expect(verifyWorkspaceExport(exportedDoc(withWorld))).toEqual({ ok: true });
    expect(verifyWorkspaceExport(exportedDoc(richState()))).toEqual({ ok: true }); // no world, single-project chain
    // a PRE-D-14 v2 document (the additive fields stripped) still verifies — no reader breaks
    const stripped = exportedDoc(withWorld) as Record<string, unknown>;
    delete stripped.launchWorld;
    delete (stripped.manifest as Record<string, unknown>).chainScopeNote;
    expect(verifyWorkspaceExport(stripped)).toEqual({ ok: true });
  });
});

describe('workspace: D-14 — the chain-scope audit note (a cross-project chain under a project-scoped label)', () => {
  /** A session that HELD two scopes: events under proj-a, then the launch adopts proj-launched and more events follow. */
  function crossScopeState(): WorkspaceState {
    let state = openWorkspace(SCOPE, T0); // proj-a
    state = reduceWorkspace(state, { kind: 'connection-changed', at: T0 + 1, status: 'connected' });
    state = reduceWorkspace(state, { kind: 'project-loaded', at: T0 + 2, project: projectRecord() });
    state = reduceWorkspace(state, { kind: 'job-updated', at: T0 + 5, job: jobRecord('running') });
    state = reduceWorkspace(state, { kind: 'project-adopted', at: T0 + 6, projectId: 'proj-launched' }); // the launch bridge / a switch
    state = reduceWorkspace(state, { kind: 'goal-loaded', at: T0 + 7, goal: goalRecord(), constraintSet: constraintSetRecord(), world: worldRecord() });
    state = reduceWorkspace(state, { kind: 'view-live', at: T0 + 8 });
    return state;
  }

  it('a chain spanning MORE THAN ONE project carries the note: the span named, every entry self-labeled, integrity unaffected — and the export still verifies END TO END', () => {
    const state = crossScopeState();
    const doc = composeWorkspaceExport(state);
    // the span is real: the history carries entries under BOTH project ids
    const projectIds = new Set(doc.events.map((entry) => entry.projectId));
    expect(projectIds).toEqual(new Set(['proj-a', 'proj-launched']));
    // the note discloses it
    expect(typeof doc.manifest.chainScopeNote).toBe('string');
    expect(doc.manifest.chainScopeNote).toContain('proj-launched'); // the export's own label
    expect(doc.manifest.chainScopeNote).toContain('proj-a');        // the spanned project
    expect(doc.manifest.chainScopeNote).toContain('2 project ids'); // the span's count
    expect(doc.manifest.chainScopeNote).toContain('self-labels its own projectId');
    expect(doc.manifest.chainScopeNote).toContain('integrity is unaffected');
    // the note survives the serialized bytes (the file is what the auditor holds)
    const manifest = (exportedDoc(state).manifest as Record<string, unknown>);
    expect(typeof manifest.chainScopeNote).toBe('string');
    // and the chain verifies END TO END from the file alone — the span never broke integrity
    expect(verifyWorkspaceExport(exportedDoc(state))).toEqual({ ok: true });
  });

  it('a SINGLE-project chain carries NO note (nothing to disclose) — and the empty-workspace export carries none either', () => {
    expect(composeWorkspaceExport(richState()).manifest.chainScopeNote).toBeUndefined();
    expect(composeWorkspaceExport(openWorkspace(SCOPE, T0)).manifest.chainScopeNote).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MI-D7 (MI wave 1, M5's finding — the export chain under INDEPENDENT
// verification): "export event seq 179's payload recomputes to a different
// digest than stored (mutated after sealing without re-hash)". Reproduced
// and root-caused here FIRST, byte-exact: the deployed demo data's outcome
// decisionRationale (deploy/vercel/runtime/demo.ts:319) carries the only
// non-ASCII character in any string the seeded records serve into an event
// payload (an em dash, U+2014) — so a demo-scope session's outcomes-loaded
// event carries exactly one non-ASCII payload string. The console's
// canonicalJson serializes it RAW (UTF-8 — JSON.stringify never escapes
// non-ASCII); an independent verifier whose canonical-JSON reading escapes
// non-ASCII (Python json.dumps' DEFAULT ensure_ascii=True, the natural
// reading of the then-published rule "canonicalJson recursively sorts
// object keys") recomputes it as \u2014 — same payload, two defensible
// readings of an underdetermined rule, two different SHA-256 digests, and
// the divergence reads exactly like M5's seq-179 symptom (one event
// mismatching in an otherwise clean chain; the eight other professionals'
// 142-268-link chains verified clean — consistent with raw-UTF-8 verifiers
// and/or ASCII-only payload sessions). ROOT CAUSE: the code path NEVER
// mutates a sealed entry (the reducer is append-only — every fold replaces
// wholesale; no write into history exists anywhere in the tree), and the
// export verifies end to end under the raw-UTF-8 form — so the defect is
// the UNDERDETERMINED canonical rule, not a mutation. The fixes below make
// the invariant hold — EVERY exported chain must verify under the
// documented in-file rules — three ways: (1) the rule now pins the
// byte-exact grammar (CHAIN_CANONICAL_RULE, embedded in every export),
// (2) the linked payload is deeply FROZEN at seal time so an in-place
// mutation after sealing is impossible BY CONSTRUCTION (append-only: a
// change arrives as a NEW event — closing the mutation hypothesis
// mechanically even though no such path existed), and (3) the console
// itself verifies the downloaded file in the UI
// (verifyWorkspaceExportReport — S5's explicit ask: no script required).
// ---------------------------------------------------------------------------

describe('workspace: MI-D7 — the non-ASCII canonical divergence + the published canonical rule', () => {
  /** The M5 shape: the demo outcome's own decisionRationale prose, em dash and all (deploy/vercel/runtime/demo.ts line 319 — the seeded adverse-gap outcome). */
  function unicodeOutcomeRecord(): OutcomeRecord {
    return {
      ...outcomeRecord(),
      outcomeId: 'out:demo0001',
      outcomeClass: 'adverse_gap',
      decisionRationale: 'The desk approved the 0.75 BTC-USD rebalance on a 0.07 weight drift against the 0.25 target; the realized fill landed -12.5 against the 45.5 expectation (tolerance 0.05) — the adverse gap post-mortem pmr:demo0001 attributes to the simulated venue lag.',
    } as unknown as OutcomeRecord;
  }

  /** A session whose outcomes-loaded event carries the non-ASCII payload (the M5 export's seq-179 class). */
  function unicodeState(): WorkspaceState {
    let state = openWorkspace(SCOPE, T0);
    state = reduceWorkspace(state, { kind: 'connection-changed', at: T0 + 1, status: 'connected' });
    state = reduceWorkspace(state, { kind: 'outcomes-loaded', at: T0 + 30, records: [unicodeOutcomeRecord()] });
    state = reduceWorkspace(state, { kind: 'view-live', at: T0 + 40 });
    return state;
  }

  /**
   * An INDEPENDENT canonical-JSON implementation — the careful verifier's
   * reimplementation of the documented rule from the file alone (recursive
   * key sort + JSON escaping), with the one degree of freedom the
   * pre-MI-D7 rule left open: whether non-ASCII characters stay RAW
   * (UTF-8 — ensure_ascii=False / jq / JSON.stringify) or escape to
   * \uXXXX (Python json.dumps' DEFAULT ensure_ascii=True).
   */
  function independentCanonicalJson(value: unknown, asciiEscaped: boolean): string {
    if (value === null) return 'null';
    if (typeof value === 'string') {
      if (!asciiEscaped) return JSON.stringify(value); // the raw-UTF-8 form
      let out = '"';
      for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code === 0x22) out += '\\"';
        else if (code === 0x5c) out += '\\\\';
        else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
        else if (code > 0x7e) out += `\\u${code.toString(16).padStart(4, '0')}`; // python's default: every non-ASCII code unit escapes
        else out += value[index];
      }
      return `${out}"`;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (Array.isArray(value)) return `[${value.map((element) => independentCanonicalJson(element, asciiEscaped)).join(',')}]`;
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${independentCanonicalJson(record[key], asciiEscaped)}`).join(',')}}`;
    }
    return 'null';
  }

  it('REPRODUCTION (the mismatch class, byte-exact): an independent ASCII-ESCAPED canonical form — Python json.dumps\' default — recomputes a DIFFERENT digest for the non-ASCII payload (the exact "recomputes to a different digest than stored" symptom class M5 reported), while the RAW-UTF-8 form recomputes the STORED digest exactly (the sealed bytes and the stored digest agree — the mismatch lives in the verifier\'s reading of the rule, not in the file)', () => {
    const state = unicodeState();
    const entry = state.history.find((candidate) => candidate.payload.kind === 'outcomes-loaded');
    if (entry === undefined) throw new Error('fixture: the outcomes-loaded event must be linked');
    // the payload carries the non-ASCII byte class (an em dash, U+2014)
    expect(JSON.stringify(entry.payload)).toContain('—');
    const chainedRecord = { seq: entry.seq, tenantId: entry.tenantId, projectId: entry.projectId, payload: entry.payload };
    const rawFormDigest = sha256Hex(independentCanonicalJson(chainedRecord, false));
    const asciiFormDigest = sha256Hex(independentCanonicalJson(chainedRecord, true));
    expect(asciiFormDigest).not.toBe(entry.digest); // the divergent reading — a different digest for exactly the one non-ASCII payload
    expect(rawFormDigest).toBe(entry.digest);       // the raw-UTF-8 reading recomputes the stored digest — internal consistency never broke
    // and the two independent readings themselves disagree (the underdetermined rule is the defect)
    expect(asciiFormDigest).not.toBe(rawFormDigest);
  });

  it('the export carrying the non-ASCII payload verifies END TO END under the console\'s own file-alone verifier (the invariant holds for every payload shape — the export composes, serializes, round-trips and verifies)', () => {
    const state = unicodeState();
    expect(verifyWorkspaceExport(JSON.parse(serializeWorkspaceExport(state)))).toEqual({ ok: true });
  });

  it('the published CANONICAL RULE now pins the byte-exact grammar — raw UTF-8 non-ASCII (never \\u-escaped), minimal JSON string escaping, the ECMAScript number form, UTF-16 code-unit key order — and names the ensure_ascii pitfall; it is embedded ADDITIVELY in every export (format version stays 2) and survives the serialized bytes', () => {
    expect(CHAIN_CANONICAL_RULE).toContain('recursively sorted');
    expect(CHAIN_CANONICAL_RULE).toContain('UTF-16 code unit');
    expect(CHAIN_CANONICAL_RULE).toContain('RAW UTF-8');
    expect(CHAIN_CANONICAL_RULE).toContain('ensure_ascii=False');
    expect(CHAIN_CANONICAL_RULE).toContain('1e-05'); // the number-form pitfall is named too (ECMAScript 0.00001, not Python repr 1e-05)
    const doc = composeWorkspaceExport(unicodeState());
    expect(doc.chain.canonicalRule).toBe(CHAIN_CANONICAL_RULE);
    expect(doc.formatVersion).toBe(2); // additive — the format version does not move
    const parsed = exportedDoc(unicodeState());
    expect((parsed.chain as Record<string, unknown>).canonicalRule).toBe(CHAIN_CANONICAL_RULE); // survives the bytes
    // a PRE-MI-D7 v2 document (the field absent — M5's own file shape) still verifies: no reader breaks, old exports stay verifiable
    const stripped = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
    delete (stripped.chain as Record<string, unknown>).canonicalRule;
    expect(verifyWorkspaceExport(stripped)).toEqual({ ok: true });
    // the digest rule POINTS at the canonical rule (sorted keys alone were never sufficient)
    expect(CHAIN_DIGEST_RULE).toContain('canonicalRule');
  });

  it('IMMUTABILITY AFTER SEAL: the linked history payload is deeply frozen at link time — an in-place mutation attempt does NOT take, the runtime chain still verifies, and the digest can never diverge from its payload (a change must arrive as a NEW event)', () => {
    const state = unicodeState();
    const entry = state.history.find((candidate) => candidate.payload.kind === 'outcomes-loaded');
    if (entry === undefined) throw new Error('fixture: the outcomes-loaded event must be linked');
    expect(Object.isFrozen(entry)).toBe(true);               // the entry itself
    expect(Object.isFrozen(entry.payload)).toBe(true);       // the payload
    const records = (entry.payload as { records?: unknown }).records;
    if (!Array.isArray(records)) throw new Error('fixture: the payload carries its records');
    expect(Object.isFrozen(records)).toBe(true);             // ...and the nested records, deeply
    expect(Object.isFrozen(records[0])).toBe(true);
    // the in-place mutation attempt (sloppy mode: silently refused; strict mode: TypeError) does NOT take
    const hostile = entry.payload as unknown as { records: Array<{ outcomeId: string }> };
    expect(() => {
      'use strict';
      hostile.records[0].outcomeId = 'out:forged';
    }).toThrow(); // a sealed record refuses the write
    expect(hostile.records[0].outcomeId).toBe('out:demo0001'); // the payload is UNCHANGED
    expect(verifyWorkspaceChain(state.history)).toEqual({ ok: true }); // the chain still verifies — the digest still matches its payload
  });

  it('the COUNTED report (the in-UI verification affordance, S5\'s ask): an honest export reports N/N digests, N/N links and the head match; a tampered one names the break with the counts up to it', () => {
    const state = unicodeState();
    const honest = verifyWorkspaceExportReport(JSON.parse(serializeWorkspaceExport(state)));
    expect(honest.ok).toBe(true);
    expect(honest.reason).toBeNull();
    expect(honest.entryCount).toBe(state.history.length);
    expect(honest.digestsOk).toBe(state.history.length);
    expect(honest.linksOk).toBe(state.history.length);
    expect(honest.headMatch).toBe(true);
    expect(honest.format).toBe('tradrl-workspace-export');
    expect(honest.formatVersion).toBe(2);
    // the tampered file: the LAST event's payload field is rewritten — the digest fails there, the counts stop one short, the head can no longer match
    const tampered = exportedDoc(state);
    const events = tampered.events as Array<Record<string, unknown>>;
    const last = events[events.length - 1] as Record<string, unknown>;
    const lastPayload = last.payload as Record<string, unknown>;
    lastPayload.at = T0 + 99_999;
    const broken = verifyWorkspaceExportReport(tampered);
    expect(broken.ok).toBe(false);
    expect(broken.reason).toContain(`event ${events.length}'s digest does not match`);
    expect(broken.entryCount).toBe(events.length);
    expect(broken.digestsOk).toBe(events.length - 1); // every digest before the break recomputed
    expect(broken.linksOk).toBe(events.length - 1);
    expect(broken.headMatch).toBe(false);
    // a non-document (not JSON of an export) is refused with a counted zero report, never a throw
    const notAnExport = verifyWorkspaceExportReport({ hello: 'world' });
    expect(notAnExport.ok).toBe(false);
    expect(notAnExport.entryCount).toBe(0);
    expect(notAnExport.headMatch).toBeNull();
  });
});

describe('workspace: MI-D9 — the manual stepping events (Step back / Step while paused, append-only)', () => {
  it('playback-step-back steps the paused view BACK one controlled step, STAYS paused, stays in the playback mode — and links as its own history entry (append-only: the step is an EVENT, never a rewrite)', () => {
    // The TM events' injected instants all sit at T0 + 2_000 — the
    // anchor must stay PAST the stepping view (the view may never point
    // after the anchor; the span here is a real 2s).
    let state = openWorkspace(SCOPE, T0);
    state = reduceWorkspace(state, { kind: 'playback-start', at: T0 + 2_000, fromAt: T0, stepMs: 500 });
    state = reduceWorkspace(state, { kind: 'playback-tick', at: T0 + 2_000 });
    state = reduceWorkspace(state, { kind: 'playback-tick', at: T0 + 2_000 });
    state = reduceWorkspace(state, { kind: 'playback-tick', at: T0 + 2_000 });
    state = reduceWorkspace(state, { kind: 'playback-paused', at: T0 + 2_000 });
    expect(viewAtOf(state)).toBe(T0 + 1_500); // three ticks of 500ms from T0
    const before = state.history.length;
    state = reduceWorkspace(state, { kind: 'playback-step-back', at: T0 + 2_000 });
    expect(state.timeMachine.mode).toBe('playback');            // no mode flip (the MI-D9 defect: playback -> t-minus)
    expect(state.timeMachine.playback?.paused).toBe(true);      // stays paused
    expect(viewAtOf(state)).toBe(T0 + 1_000);                   // one step BACK (the defect: jumped to anchor-500ms)
    expect(state.history.length).toBe(before + 1);              // append-only — the step linked as its own event
    expect(state.history[state.history.length - 1]?.kind).toBe('playback-step-back');
    expect(verifyWorkspaceChain(state.history)).toEqual({ ok: true }); // the chain still verifies
  });

  it('playback-step-forward is the user\'s own step while paused: one step forward, STAYING paused (the freeze stops the beat\'s ticks, never the Step control)', () => {
    let state = openWorkspace(SCOPE, T0);
    state = reduceWorkspace(state, { kind: 'playback-start', at: T0 + 2_000, fromAt: T0, stepMs: 500 });
    state = reduceWorkspace(state, { kind: 'playback-tick', at: T0 + 2_000 });
    state = reduceWorkspace(state, { kind: 'playback-paused', at: T0 + 2_000 });
    state = reduceWorkspace(state, { kind: 'playback-step-forward', at: T0 + 2_000 });
    expect(state.timeMachine.playback?.paused).toBe(true);  // still paused — a manual step is not a resume
    expect(viewAtOf(state)).toBe(T0 + 1_000);                // one step forward from the frozen T0+500
  });
});

// ---------------------------------------------------------------------------
// FW-32-B (Round A blocker 4) — THE SCRUBBER'S HISTORY ANCHOR: the floor
// derives HONESTLY from the records the state holds (the honest-derivation
// law), never the session start when history exists, and never a fabricated
// instant. The pre-session event history (the auditor's incident review)
// stays reachable across every load/reload.
// ---------------------------------------------------------------------------

describe('workspace: FW-32-B — the scrubber history floor (the honest-derivation law)', () => {
  it('a state with NO records derives the SESSION fallback (the open instant), disclosed as such — never presented as record-derived', () => {
    const state = openWorkspace(SCOPE, T0);
    expect(earliestRecordInstantOf(state)).toBeNull(); // nothing on hand — the fold yields nothing
    expect(historyFloorOf(state)).toEqual({ floorAt: T0, derived: 'session' });
  });

  it('the fold derives the earliest record instant across every kind the state holds — the project\'s own creation wins when it is earliest', () => {
    let state = openWorkspace(SCOPE, T0);
    state = reduceAll(state, [
      { kind: 'project-loaded', at: T0 + 1, project: projectRecord() },                 // createdAt T0
      { kind: 'job-updated', at: T0 + 2, job: jobRecord('complete') },                  // submittedAt T0+20
      { kind: 'outcome-recorded', at: T0 + 3, outcome: outcomeRecord() },               // asOf T0+30
      { kind: 'org-snapshot', at: T0 + 4, snapshot: orgSnapshot() },                    // at T0+10
    ]);
    expect(earliestRecordInstantOf(state)).toBe(T0); // the project's own createdAt — the project's beginning
    expect(historyFloorOf(state)).toEqual({ floorAt: T0, derived: 'records' });
  });

  it('PRE-SESSION history anchors the floor below the session start — the auditor\'s incident review (a deep-past refusal) is reachable after every reload', () => {
    const incidentAt = T0 - 86_400_000; // a full day before the session opened
    const refusal: GatewaySubmissionRecord = {
      submissionId: 'sub-1', decisionId: 'dec-1', auditId: 'xga:1', tenant: 'tenant-a', project: 'proj-a',
      kind: 'refused', refusal: { stage: 'risk_limits', bound: '2', observed: '2.4', constraintId: 'k-position' },
      refusedAt: incidentAt,
    } as unknown as GatewaySubmissionRecord;
    const preSessionJob: JobRecord = { jobId: 'job-old', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'complete', submittedAt: incidentAt + 100, completedAt: incidentAt + 900 };
    let state = openWorkspace(SCOPE, T0); // the session opens a DAY after the incident
    state = reduceAll(state, [
      { kind: 'project-loaded', at: T0 + 1, project: projectRecord({ createdAt: T0 - 3_600_000 }) },
      { kind: 'job-updated', at: T0 + 2, job: preSessionJob },
      { kind: 'submission-recorded', at: T0 + 3, submission: refusal },
    ]);
    // the fold reaches the REFUSAL's own instant — the exact record the incident review is here for
    expect(earliestRecordInstantOf(state)).toBe(incidentAt);
    expect(historyFloorOf(state)).toEqual({ floorAt: incidentAt, derived: 'records' });
    expect(historyFloorOf(state).floorAt).toBeLessThan(state.openedAt); // BELOW the session start — the pre-fix floor (openedAt) hid it
  });

  it('the fold is pure and deterministic — the same state derives the same floor, and a completed job\'s SUBMISSION instant counts (its record began there)', () => {
    const submittedDeep = T0 - 7_200_000;
    const job: JobRecord = { jobId: 'job-deep', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'complete', submittedAt: submittedDeep, completedAt: T0 + 5 };
    let state = openWorkspace(SCOPE, T0);
    state = reduceAll(state, [
      { kind: 'project-loaded', at: T0 + 1, project: projectRecord() },
      { kind: 'job-updated', at: T0 + 2, job },
    ]);
    const first = historyFloorOf(state);
    expect(first).toEqual({ floorAt: submittedDeep, derived: 'records' }); // submittedAt — not completedAt (the record began at submission)
    expect(historyFloorOf(state)).toEqual(first);                          // deterministic: the same state, the same floor
  });
});
