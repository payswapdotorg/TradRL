// Tests for THE RESEARCH→DECISION PROMOTION SURFACE (FW-32-A, Round A
// blocker 2 — 5/9 personas: "my research never reaches a decision"):
//   - the completed research job's detail sheet carries the "Propose as
//     decision" affordance (ONLY for a completed research job with a
//     release-candidate result — the route's own eligibility, mirrored);
//   - a job whose decision is already promoted renders the PROMOTED state
//     (the decision ref — never a second button);
//   - the promoted decision renders in the Decisions section WITH its
//     evidence + THE PRODUCING-JOB BACKLINK (the decision→job lineage
//     Round A's C02 audits demanded);
//   - the reducer's outcome-recorded merge is deduped by outcomeId (the
//     idempotence the host route guarantees server-side, mirrored
//     client-side).

import { describe, expect, it } from 'vitest';
import type { JobRecord, OutcomeRecord } from '../api/contracts';
import { openWorkspace, reduceAll, type WorkspaceEvent } from '../core/workspace';
import { renderConsoleModel } from './model';
import { defaultShellView } from './shell';
import { serializeVNode } from './vtree';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
const T0 = 1_700_000_000_000;

function researchJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    jobId: 'job:research01',
    kind: 'research',
    tenant: 'tenant-a',
    project: 'proj-a',
    status: 'complete',
    submittedAt: T0 + 10,
    completedAt: T0 + 18,
    result: { kind: 'release-candidate', specId: 'spec-demo-director', version: 1, project: 'proj-a' },
    ...overrides,
  };
}

function promotedDecision(jobId: string): OutcomeRecord {
  return {
    outcomeId: 'out:promo0001',
    ordinal: 1,
    tenant: 'tenant-a',
    project: 'proj-a',
    decision: { decisionRef: 'xd:promo0001', intentRef: 'si:promo0001', disposition: 'filled' },
    outcomeClass: 'no_execution',
    expectation: { expectedQuantity: '1', expectedRealized: '1', tolerance: '0', declaredBy: 'spec-demo-director' },
    realization: { filledQuantity: '1', realizedOutcome: '1', feeTotal: '0', notionalTotal: '0', unrealizedAtDecision: '0' },
    deviation: { quantityShortfall: '0', realizedGap: '0', withinTolerance: true },
    evidence: [{ kind: 'decision', ref: 'xd:promo0001' }],
    decisionBody: 'desk:research-promotion',
    decisionRationale: `The research job ${jobId} completed; its release-candidate deliverable (spec spec-demo-director, version 1) is promoted as this decision on the professional's proposal. No execution ran (outcome class no_execution).`,
    promotedFromJob: jobId,
    lineage: {
      shadow: {
        sessionId: 'shs:promo0001', fidelity: { mode: 'shadow', fill_origin: 'simulated' },
        executionPolicy: { policyId: 'xp-promote', version: 1 }, riskPolicy: { policyId: 'rp-promote', version: 1 },
        configDigests: { worldConfigHash: 'w', engineConfigHash: 'e', dataset: 'd' },
        run: { runId: 'r', episodeId: 'ep' }, cursor: { cursorId: 'c', position: 1 },
        seed: 's', tenant: 'tenant-a', project: 'proj-a',
      },
      shadowOutcomeRef: 'swo:promo0001', shadowOutcomeOrdinal: 1, shadowAsOf: T0 + 18,
      decisionStreamPosition: 1, trajectoryRef: null, experiment: null,
    },
    asOf: T0 + 40,
    priorChainHead: '00000000',
  } as unknown as OutcomeRecord;
}

function jobSheetBytes(state: ReturnType<typeof openWorkspace>, jobId: string): string {
  const viewed = reduceAll(state, [{ kind: 'anchor-advanced', at: T0 + 50 } as WorkspaceEvent]);
  return serializeVNode(renderConsoleModel(viewed, T0 + 50, { ...defaultShellView(viewed), accountView: 'section', sheet: { kind: 'job', id: jobId } }));
}

function decisionsBytes(state: ReturnType<typeof openWorkspace>): string {
  const viewed = reduceAll(state, [
    { kind: 'anchor-advanced', at: T0 + 50 } as WorkspaceEvent,
    { kind: 'section-selected', at: T0 + 50, section: 'decisions' } as WorkspaceEvent,
  ]);
  return serializeVNode(renderConsoleModel(viewed, T0 + 50, { ...defaultShellView(viewed), accountView: 'section' }));
}

describe('the research→decision promotion surface (FW-32-A, Round A blocker 2)', () => {
  it('a completed research job with a release-candidate result carries the "Propose as decision" affordance on its sheet', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'job-updated', at: T0 + 20, job: researchJob() } as WorkspaceEvent,
    ]);
    const bytes = jobSheetBytes(state, 'job:research01');
    expect(bytes).toContain('Propose as decision');
    expect(bytes).toContain('data-action="job-promote"');
    expect(bytes).toContain('data-job-promote="job:research01"');
  });

  it('FW-33-B (Round B blocker 2): the affordance rides INSIDE the dialog surface — the LEAD of the sheet body, never a backdrop-covered sibling after the aside', () => {
    // THE DEFECT: the affordance rendered AFTER `aside.sheet` as a page-left
    // sibling below the fold, where the fixed `button.sheet-backdrop`
    // (z-index 40, inset 0) covered it — elementFromPoint at its center hit
    // the backdrop; only Tab+Enter reached it (7/9 personas).
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'job-updated', at: T0 + 20, job: researchJob() } as WorkspaceEvent,
    ]);
    const bytes = jobSheetBytes(state, 'job:research01');
    const bodyIndex = bytes.indexOf('class="sheet-body"');
    const affordanceIndex = bytes.indexOf('data-job-promotion="available"');
    const statusIndex = bytes.indexOf('>STATUS<');
    const sheetCloseIndex = bytes.indexOf('</aside>', bodyIndex);
    expect(bodyIndex).toBeGreaterThan(-1);
    expect(affordanceIndex).toBeGreaterThan(bodyIndex); // INSIDE the sheet body, not a sibling
    expect(affordanceIndex).toBeLessThan(statusIndex);  // the LEAD slot: above the definition grid — visible without scrolling when the sheet opens
    expect(affordanceIndex).toBeLessThan(sheetCloseIndex); // inside the dialog's own closing tag
    // the job's OWN evidence capsule rides the FOOTER slot — inside the dialog too (the same defect class, fixed with it)
    const capsuleIndex = bytes.indexOf('data-capsule-row=');
    expect(capsuleIndex).toBeGreaterThan(bodyIndex);
    expect(capsuleIndex).toBeGreaterThan(statusIndex);   // the footer: below the definition grid, inside the scrollable dialog
    expect(capsuleIndex).toBeLessThan(sheetCloseIndex);
    // the backdrop covers ONLY outside the dialog: it opens BEFORE the aside and never reappears after the sheet's close
    const backdropIndex = bytes.indexOf('class="sheet-backdrop"');
    const asideIndex = bytes.indexOf('class="sheet"');
    expect(backdropIndex).toBeGreaterThan(-1);
    expect(backdropIndex).toBeLessThan(asideIndex);
    expect(bytes.indexOf('class="sheet-backdrop"', asideIndex)).toBe(-1);
    // the affordance is a real button inside the dialog (the keyboard path stays: focusable, actionable)
    expect(bytes).toContain('data-action="job-promote"');
  });

  it('the affordance never renders for a job the route would honestly refuse (not complete, not research, not a release candidate)', () => {
    for (const job of [
      researchJob({ status: 'running', completedAt: undefined }),
      researchJob({ kind: 'learning', result: { kind: 'training-summary', epochs: 3, project: 'proj-a' } }),
      researchJob({ result: undefined }),
    ]) {
      const state = reduceAll(openWorkspace(SCOPE, T0), [{ kind: 'job-updated', at: T0 + 20, job } as WorkspaceEvent]);
      const bytes = jobSheetBytes(state, job.jobId);
      expect(bytes).not.toContain('Propose as decision');
      expect(bytes).not.toContain('data-action="job-promote"');
    }
  });

  it('a promoted job renders the PROMOTED state (the decision ref) — never a second button', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'job-updated', at: T0 + 20, job: researchJob() } as WorkspaceEvent,
      { kind: 'outcome-recorded', at: T0 + 42, outcome: promotedDecision('job:research01') } as WorkspaceEvent,
    ]);
    const bytes = jobSheetBytes(state, 'job:research01');
    expect(bytes).toContain('PROMOTION');
    expect(bytes).toContain('promoted as a decision');
    expect(bytes).toContain('xd:promo0001');
    expect(bytes).not.toContain('data-action="job-promote"'); // the affordance's honest end state
  });

  it('the promoted decision renders in the Decisions section WITH its evidence and THE PRODUCING-JOB BACKLINK (the C02 lineage)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'job-updated', at: T0 + 20, job: researchJob() } as WorkspaceEvent,
      { kind: 'outcome-recorded', at: T0 + 42, outcome: promotedDecision('job:research01') } as WorkspaceEvent,
    ]);
    const bytes = decisionsBytes(state);
    expect(bytes).toContain('Decision xd:promo0001');
    expect(bytes).toContain('desk:research-promotion'); // the named deciding body
    expect(bytes).toContain('job:research01'); // the rationale + the backlink cite the producing job
    expect(bytes).toContain('producing job');
    expect(bytes).toContain('Open the producing job'); // the working backlink (the data-row sheet grammar)
    expect(bytes).toContain('data-row="job:job:research01"');
    expect(bytes).toContain('no_execution');
  });

  it('the reducer: outcome-recorded merges deduped by outcomeId (the idempotence mirror — never a duplicate)', () => {
    const base = openWorkspace(SCOPE, T0);
    const once = reduceAll(base, [{ kind: 'outcome-recorded', at: T0 + 42, outcome: promotedDecision('job:research01') } as WorkspaceEvent]);
    expect(once.outcomes).toHaveLength(1);
    const twice = reduceAll(once, [{ kind: 'outcome-recorded', at: T0 + 60, outcome: promotedDecision('job:research01') } as WorkspaceEvent]);
    expect(twice.outcomes).toHaveLength(1); // the same record again is a no-op
  });

  it('the reducer: a foreign-scope outcome never enters the state (L12 — the typed gate)', () => {
    const foreign = { ...promotedDecision('job:research01'), project: 'proj-other' } as unknown as OutcomeRecord;
    expect(() => reduceAll(openWorkspace(SCOPE, T0), [{ kind: 'outcome-recorded', at: T0 + 42, outcome: foreign } as WorkspaceEvent])).toThrow();
  });
});
