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
import type { GoalStatement, JobRecord, OrgStatusSnapshot, OutcomeRecord, ProjectRecord, ServedKnowledge } from '../api/contracts';
import { openWorkspace, reduceAll, reduceWorkspace, serializeWorkspace, verifyWorkspaceChain, viewAtOf, type WorkspaceEvent, type WorkspaceState } from './workspace';
import { WORKSPACE_SECTIONS } from './sections';
import { CrossTenantRenderError } from './errors';

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
    // the loaded project record pins the adoption; a DIFFERENT second adoption is refused
    const withProject = reduceWorkspace(adopted, { kind: 'project-loaded', at: T0 + 2, project: projectRecord({ id: 'proj-new', lifecycle: { projectId: 'proj-new', status: 'draft', acceptanceCriteriaId: null, organizationRef: null } }) });
    expect(() => reduceWorkspace(withProject, { kind: 'project-adopted', at: T0 + 3, projectId: 'proj-other' })).toThrow(/already adopted/);
    // re-adopting the SAME project is a no-op (idempotent)
    expect(() => reduceWorkspace(withProject, { kind: 'project-adopted', at: T0 + 4, projectId: 'proj-new' })).not.toThrow();
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
    state = reduceWorkspace(state, { kind: 'org-snapshot', at: T0 + 2, snapshot: orgSnapshot() });
    state = reduceWorkspace(state, { kind: 'outcomes-loaded', at: T0 + 3, records: [outcomeRecord()] });
    state = reduceWorkspace(state, { kind: 'knowledge-loaded', at: T0 + 4, records: [knowledgeRecord()] });
    state = reduceWorkspace(state, { kind: 'job-updated', at: T0 + 5, job: jobRecord('complete') });
    expect(state.project?.id).toBe('proj-a'); // the deployed boot's loaded world

    const adopted = reduceWorkspace(state, { kind: 'project-adopted', at: T0 + 6, projectId: 'proj-launched' });
    expect(adopted.scope.projectId).toBe('proj-launched'); // the workspace FOLLOWS the launch
    expect(adopted.project).toBeNull();                    // the prior project's records left the sections…
    expect(adopted.goal).toBeNull();
    expect(adopted.constraintSet).toBeNull();
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
    let next = reduceWorkspace(adopted, { kind: 'project-loaded', at: T0 + 9, project: projectRecord({ id: 'proj-launched', lifecycle: { projectId: 'proj-launched', status: 'draft', acceptanceCriteriaId: null, organizationRef: null }, lineage: { projectId: 'proj-launched', createdAt: T0, createdBy: 'worker', priorVersion: null, version: 1 } }) });
    next = reduceWorkspace(next, { kind: 'job-updated', at: T0 + 10, job: { ...jobRecord('submitted'), project: 'proj-launched' } });
    expect(next.project?.id).toBe('proj-launched');
    expect(next.jobs).toHaveLength(1);
    expect(next.jobs[0]?.status).toBe('submitted');

    // re-adopting the NOW-LOADED created project is idempotent (no record churn)
    const reAdopted = reduceWorkspace(next, { kind: 'project-adopted', at: T0 + 11, projectId: 'proj-launched' });
    expect(reAdopted.project?.id).toBe('proj-launched');
    expect(reAdopted.jobs).toHaveLength(1);
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
  it('every event links one entry; seq is 1-based and contiguous; the chain verifies', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'org-snapshot', at: T0 + 10, snapshot: orgSnapshot() },
      { kind: 'job-updated', at: T0 + 20, job: jobRecord() },
    ]);
    expect(state.history.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(state.history.map((entry) => entry.kind)).toEqual(['connection-changed', 'org-snapshot', 'job-updated']);
    expect(state.history[0]?.tenantId).toBe('tenant-a');
    expect(state.history[0]?.chainHead).toMatch(/^[0-9a-f]{8}$/);
    expect(verifyWorkspaceChain(state.history)).toEqual({ ok: true });
  });

  it('tampering with any entry is detected (the FIRST broken seq is named)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'org-snapshot', at: T0 + 10, snapshot: orgSnapshot() },
      { kind: 'job-updated', at: T0 + 20, job: jobRecord() },
    ]);

    const tamperedDigest = state.history.map((entry, index) => (index === 1 ? { ...entry, digest: 'deadbeef' } : entry));
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
});
