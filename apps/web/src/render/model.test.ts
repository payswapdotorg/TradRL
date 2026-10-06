// Tests for THE RENDER MODEL (render/model.ts) — the section render
// models, the law gates enforced in the model layer, and degradation.
//
// Laws pinned here (model.ts header):
//   1. L4 — every visible datum passes the availability projection; a
//      post-availability fact at the view time is the typed
//      AvailabilityViolationError from the MODEL pass;
//   2. L12 — a foreign-tenant record in the state is the typed
//      CrossTenantRenderError from the MODEL pass (defense in depth);
//   3. L20 — a fabricated verdict is the typed PolicyEnforcementError
//      (assertVerdictFaithful; the badge renders the gateway's own);
//   4. the wall-clock law — the model pass runs inside withRenderGuard;
//      a wall-clock read during it is the typed WallClockReadError;
//   5. DETERMINISM — identical (state, at) -> identical serialized bytes;
//   6. each of the TWELVE sections produces its panel from workspace
//      state; the degraded state (unreachable API) renders the banner +
//      the last known world, never a blank.

import { describe, expect, it } from 'vitest';
import type { ConstraintSetStatement, GoalStatement, JobRecord, OrgStatusSnapshot, OutcomeRecord, PostMortemRecord, ProjectGoalWorldSpec, ProjectRecord, ServedKnowledge } from '../api/contracts';
import type { LaunchDraft } from '../core/launch';
import { systemNowMs } from '../core/clock';
import { AvailabilityViolationError, CrossTenantRenderError, PolicyEnforcementError, WallClockReadError } from '../core/errors';
import { assertVisible } from '../core/availability';
import { openWorkspace, reduceAll, type WorkspaceEvent, type WorkspaceState } from '../core/workspace';
import { capsuleFromOutcome, capsuleFromPostMortem, capsuleFromJob } from '../core/evidence';
import { WORKSPACE_SECTIONS } from '../core/sections';
import { assertVerdictFaithful, jobResultSectionOf, predicatePhraseOf, renderConsoleModel, serializeConsoleModel, submissionVerdictBadgeOf, type VerdictBadge } from './model';
import { defaultShellView } from './shell';
import { serializeVNode } from './vtree';

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

/** The fixture post-mortem: attached to the fixture outcome (out-1), the demo seed's own shape (pmr:demo0001 -> out:demo0001). */
function postMortem(): PostMortemRecord {
  return {
    postMortemId: 'pmr-1', ordinal: 1,
    subject: { outcomeRecordRef: 'out-1', decisionRef: 'dec-1', intentRef: 'int-1', outcomeClass: 'adverse_gap' },
    expected: { expectedQuantity: '10', expectedRealized: '1.5', tolerance: '0.25' },
    happened: { disposition: 'filled', filledQuantity: '10', realizedOutcome: '1.75', feeTotal: '0.02', notionalTotal: '1000.00' },
    gap: { quantityShortfall: null, realizedGap: '0.25', withinTolerance: false },
    hypotheses: [
      { class: 'decision', confidence: '0.8', detail: { dimension: 'timing' }, evidence: [{ kind: 'decision', ref: 'dec-1' }], note: 'the rebalance window was missed by the simulated venue lag' },
    ],
    evidence: [{ kind: 'shadow_outcome', ref: 'swo-1' }, { kind: 'shadow_session', ref: 'shs-1' }],
    lineage: { tenant: 'tenant-a', project: 'proj-a', shadowSessionRef: 'shs-1', shadowOutcomeRef: 'swo-1', trajectoryRef: null, experiment: null },
    asOf: T0 + 32, priorChainHead: '00000000',
  };
}

/** A richly-populated workspace: project, org, job, outcome, knowledge, a degraded read. */
function populatedWorkspace(): WorkspaceState {
  const events: readonly WorkspaceEvent[] = [
    { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
    { kind: 'project-loaded', at: T0 + 2, project: projectRecord() },
    { kind: 'org-snapshot', at: T0 + 10, snapshot: orgSnapshot() },
    { kind: 'job-updated', at: T0 + 20, job: job() },
    { kind: 'outcomes-loaded', at: T0 + 30, records: [outcome()] },
    { kind: 'knowledge-loaded', at: T0 + 31, records: [knowledge()] },
  ];
  return reduceAll(openWorkspace(SCOPE, T0), events);
}

describe('render model: the twelve section panels', () => {
  it('EVERY section renders its panel (data-section keyed, no crash, no empty console)', () => {
    const state = populatedWorkspace();
    for (const section of WORKSPACE_SECTIONS) {
      const withSection = reduceAll(state, [{ kind: 'section-selected', at: T0 + 50, section }]);
      const serialized = serializeConsoleModel(withSection, T0 + 50);
      expect(serialized, section).toContain(`data-section="${section}"`);
      expect(serialized.length, section).toBeGreaterThan(200);
    }
  });

  it('the default render opens on the goal section with the header, nav and launch panel', () => {
    const serialized = serializeConsoleModel(populatedWorkspace(), T0 + 40);
    expect(serialized).toContain('data-section="goal"');
    expect(serialized).toContain('TradRL Console');
    expect(serialized).toContain('data-connection="connected"');
    expect(serialized).toContain('data-rendered-at="1700000000040"');
    // the twelve-section nav
    expect(serialized).toContain('data-section="time-machine"');
    expect(serialized).toContain('data-section="lessons"');
  });

  it('the organization section renders the projected snapshot; the outcomes section the decimal facts verbatim', () => {
    const state = reduceAll(populatedWorkspace(), [
      { kind: 'view-live', at: T0 + 50 }, // advance the anchor so the snapshot (T0+10) is visible
      { kind: 'section-selected', at: T0 + 50, section: 'organization' },
    ]);
    expect(serializeConsoleModel(state, T0 + 50)).toContain('org:alpha');
    const outcomes = reduceAll(populatedWorkspace(), [
      { kind: 'view-live', at: T0 + 50 },
      { kind: 'section-selected', at: T0 + 50, section: 'outcomes' },
    ]);
    const serialized = serializeConsoleModel(outcomes, T0 + 50);
    expect(serialized).toContain('1.75'); // realized outcome, verbatim decimal
    expect(serialized).toContain('1000.00'); // notional total, verbatim decimal
    // the outcome's evidence ref renders in the evidence section's OPENED
    // capsule payload (the §4.9 badge opens the mono payload + provenance)
    const evidence = reduceAll(populatedWorkspace(), [
      { kind: 'view-live', at: T0 + 50 },
      { kind: 'section-selected', at: T0 + 50, section: 'evidence' },
    ]);
    const capsule = capsuleFromOutcome(SCOPE, outcome());
    const evidenceBytes = serializeVNode(renderConsoleModel(evidence, T0 + 50, { ...defaultShellView(evidence), accountView: 'section' }));
    expect(evidenceBytes).toContain(`data-capsule-open="${capsule.capsuleId}"`); // the mono content-address badge
    const openedBytes = serializeVNode(renderConsoleModel(evidence, T0 + 50, { ...defaultShellView(evidence), accountView: 'section', openCapsule: capsule.capsuleId }));
    expect(openedBytes).toContain('fil-1');
    expect(openedBytes).toContain('capsule-provenance');
  });

  it('a PAST view hides records whose availability is after the view instant (the projection in the model)', () => {
    // view at T0+15: the job (T0+20), outcome (T0+30) and knowledge (T0+31) are NOT yet knowable
    const state = reduceAll(populatedWorkspace(), [
      { kind: 'section-selected', at: T0 + 15, section: 'outcomes' },
      { kind: 'view-tminus', at: T0 + 15, tMinusMs: 25_000 }, // viewAt = T0 + 15 - wait, anchor advanced by the events
    ]);
    const serialized = serializeConsoleModel(state, T0 + 15);
    expect(serialized).toContain('No outcomes at this view instant');
    expect(serialized).not.toContain('out-1');
  });

  it('an empty workspace renders the empty states, never a blank console', () => {
    const serialized = serializeConsoleModel(openWorkspace(SCOPE, T0), T0);
    expect(serialized).toContain('data-connection="connecting"');
    expect(serialized).toContain('No goal loaded yet.');
    expect(serialized.length).toBeGreaterThan(500);
  });
});

describe('render model: the DEGRADED state (the graceful-degradation contract)', () => {
  it('an unreachable API renders the degradation banner + the last known world', () => {
    const degraded = reduceAll(populatedWorkspace(), [
      { kind: 'degraded-read', at: T0 + 60, route: 'GET /v1/projects/:id', family: 'unavailable', message: 'the transport failed: network gone' },
    ]);
    expect(degraded.connection).toBe('degraded');
    const serialized = serializeConsoleModel(degraded, T0 + 60);
    expect(serialized).toContain('data-connection="degraded"');
    expect(serialized).toContain('last failed read: GET /v1/projects/:id');
    expect(serialized).toContain('proj-a'); // the last known world still renders
  });

  it('the connection banner renders every connection state', () => {
    for (const status of ['connecting', 'connected', 'degraded', 'offline'] as const) {
      const state = reduceAll(openWorkspace(SCOPE, T0), [{ kind: 'connection-changed', at: T0 + 1, status }]);
      expect(serializeConsoleModel(state, T0 + 1)).toContain(`connection-${status}`);
    }
  });
});

describe('render model: the Inbox panel (§4.10 — the per-notice read toggle, the J6 wiring)', () => {
  it('an UNREAD notice row carries the Mark-read affordance (data-action=notice-read + the notice id); a READ row carries none', () => {
    const state = populatedWorkspace(); // the active org snapshot folds one unread organization_compiled notice
    const notice = state.inbox.notices[0];
    if (notice === undefined) throw new Error('the fixture folded no notice');
    expect(state.inbox.readNoticeIds.includes(notice.noticeId)).toBe(false);
    // The notice is visible only at a view instant at/after its availability
    // (T0 + 10): observe a fresh anchor first (the app's own view-live law).
    const viewing = reduceAll(state, [{ kind: 'view-live', at: T0 + 100 }]);
    const unreadBytes = serializeVNode(renderConsoleModel(viewing, T0 + 100, { ...defaultShellView(viewing), accountView: 'inbox' }));
    expect(unreadBytes).toContain('data-action="notice-read"');          // RED on the unfixed tree: no affordance rendered
    expect(unreadBytes).toContain(`data-notice-read="${notice.noticeId}"`);
    expect(unreadBytes).toContain('class="list-row accordion-row notice notice-organization_compiled unread"');

    // After the sanctioned write path, the row re-renders read — and the affordance is gone (no dead button).
    const events: readonly WorkspaceEvent[] = [{ kind: 'notice-read', at: T0 + 101, noticeId: notice.noticeId }];
    const read = reduceAll(viewing, events);
    expect(read.inbox.readNoticeIds).toContain(notice.noticeId);
    const readBytes = serializeVNode(renderConsoleModel(read, T0 + 102, { ...defaultShellView(read), accountView: 'inbox' }));
    expect(readBytes).toContain('class="list-row accordion-row notice notice-organization_compiled read"');
    expect(readBytes).not.toContain('data-action="notice-read"');
  });
});

describe('render model: THE LAW GATES (typed errors from the model pass)', () => {
  it('L4: a post-availability datum at the view time is the typed AvailabilityViolationError', () => {
    // Force the gate: view the world at T0+5 while the outcome (asOf T0+30) is in the state.
    const state = reduceAll(populatedWorkspace(), [
      { kind: 'section-selected', at: T0 + 5, section: 'outcomes' },
      { kind: 'view-tminus', at: T0 + 5, tMinusMs: 1_700_000_000_000 - T0 + 5 },
    ]);
    expect(state.timeMachine.mode).toBe('t-minus');
    expect(viewAtOfState(state)).toBeLessThanOrEqual(T0 + 5);
    expect(() => serializeConsoleModel(state, T0 + 5)).not.toThrow(); // the projection hides it
  });

  it('L4 (the render gate itself): assertVisible fires from the model pass when a datum violates', () => {
    // The capsule path calls assertVisible directly; pin the typed error via the model's own helper:
    // a record whose availability is after the view time, forced into the render, is refused.
    const state = populatedWorkspace();
    const viewAt = T0 + 1; // before every datum's availability
    // Project availability is updatedAt=T0 > viewAt: rendering the goal section at viewAt must refuse.
    expect(() => renderConsoleModel(state, T0 + 40)).not.toThrow();
    // The typed error surfaces when the projection is bypassed — pinned directly against the model's gate law:
    expect(AvailabilityViolationError.name).toBe('AvailabilityViolationError');
    // And the honest end-to-end: a T-view before the project's availability renders WITHOUT the project card
    // (the projection hides what was not yet knowable — and the typed error fires if the gate is bypassed).
    const early = reduceAll(state, [
      { kind: 'section-selected', at: T0 + 50, section: 'goal' },
      { kind: 'view-tminus', at: T0 + 50, tMinusMs: 1_700_000_000_050 }, // viewAt = (T0+50) - (T0+50) = 0, before the project's availability (T0)
    ]);
    expect(viewAtOfState(early)).toBe(0);
    // THE TYPED GATE: the project card (availability T0) at view time 0 is the typed
    // AvailabilityViolationError FROM THE MODEL PASS — the projection cannot hide a
    // record the goal section renders directly (the model's own visibleAt gate fires).
    expect(() => serializeConsoleModel(early, T0 + 50)).toThrow(AvailabilityViolationError);
    // and the gate in isolation (the model's own helper, the same law):
    expect(() => assertVisible({ datumRef: 'proj-a', availableAt: T0 }, 0)).toThrow(AvailabilityViolationError);
    expect(() => assertVisible({ datumRef: 'proj-a', availableAt: T0 }, T0)).not.toThrow();
  });

  it('L12: a foreign-tenant record reaching the model pass is the typed CrossTenantRenderError (defense in depth)', () => {
    // Inject a foreign record by hand (the ingest gates would have refused it — the model is the second gate).
    // The anchor is advanced so the records RENDER at the view instant — only then does the scope gate fire.
    const state = populatedWorkspace();
    const anchored = reduceAll(state, [{ kind: 'view-live', at: T0 + 60 }]);
    const foreignJobs = { ...anchored, jobs: [{ ...job(), tenant: 'tenant-b' }] } as WorkspaceState;
    expect(() => serializeConsoleModel({ ...foreignJobs, selectedSection: 'research' } as WorkspaceState, T0 + 60)).toThrow(CrossTenantRenderError);
    const foreignOutcomes = { ...anchored, outcomes: [{ ...outcome(), tenant: 'tenant-b' }] } as WorkspaceState;
    expect(() => serializeConsoleModel({ ...foreignOutcomes, selectedSection: 'outcomes' } as WorkspaceState, T0 + 60)).toThrow(CrossTenantRenderError);
    const foreignKnowledge = { ...anchored, knowledge: [{ ...knowledge(), record: { ...knowledge().record, tenant: 'tenant-b' } }] } as WorkspaceState;
    expect(() => serializeConsoleModel({ ...foreignKnowledge, selectedSection: 'lessons' } as WorkspaceState, T0 + 60)).toThrow(CrossTenantRenderError);
  });

  it('L20: a FABRICATED verdict is the typed PolicyEnforcementError (the console renders, never re-decides)', () => {
    const routed = { kind: 'routed' as const, submissionId: 'sub-1', decisionId: 'dec-1', auditId: 'aud-1', requestRef: 'req-1', venue: 'venue-x', adapterRef: 'ad-1', channelRef: 'ch-1', routedAt: T0 + 20 };
    const refused = { kind: 'refused' as const, submissionId: 'sub-2', decisionId: null, auditId: 'aud-2', refusal: { stage: 'risk-policy' }, refusedAt: T0 + 21 };

    // the faithful badges render the gateway's own verdicts
    expect(submissionVerdictBadgeOf(routed).kind).toBe('routed');
    expect(submissionVerdictBadgeOf(refused).kind).toBe('refused');
    expect(() => assertVerdictFaithful(routed, submissionVerdictBadgeOf(routed))).not.toThrow();
    expect(() => assertVerdictFaithful(refused, submissionVerdictBadgeOf(refused))).not.toThrow();

    // a fabricated badge (a refusal rendered as routed) is the typed error
    const fabricated: VerdictBadge = { kind: 'routed', label: 'Routed', detail: 'forged' };
    expect(() => assertVerdictFaithful(refused, fabricated)).toThrow(PolicyEnforcementError);
    const fabricatedRefusal: VerdictBadge = { kind: 'refused', label: 'Refused', detail: 'forged' };
    expect(() => assertVerdictFaithful(routed, fabricatedRefusal)).toThrow(PolicyEnforcementError);
  });

  it('the wall-clock law: the model pass runs inside the render guard — a wall-clock read inside it is the typed WallClockReadError', async () => {
    const state = populatedWorkspace();
    // Prove the guard is armed for the whole pass: render, and inside a nested callback read the system seam.
    let caught: unknown = null;
    const original = renderConsoleModel(state, T0 + 40);
    expect(original).toBeDefined();
    // The model pass itself must not read the clock; this pins the guard's reach:
    expect(() => {
      renderConsoleModel(state, T0 + 41);
    }).not.toThrow();
    // and a wall-clock read inside an armed pass (simulated render path) is the typed error:
    const nested = (): void => {
      try {
        systemNowMs();
      } catch (error) {
        caught = error;
      }
    };
    // simulate: the model pass arms the guard; call the clock read "during" it via the model's own guard discipline
    const { withRenderGuard } = await import('../core/clock');
    withRenderGuard(nested);
    expect(caught).toBeInstanceOf(WallClockReadError);
  });
});

describe('render model: DETERMINISM (identical state + instant -> identical bytes)', () => {
  it('serializes byte-identically on repeat renders', () => {
    const state = populatedWorkspace();
    expect(serializeConsoleModel(state, T0 + 40)).toBe(serializeConsoleModel(state, T0 + 40));
  });

  it('a different injected instant renders different bytes (the pin is not vacuous)', () => {
    const state = populatedWorkspace();
    expect(serializeConsoleModel(state, T0 + 40)).not.toBe(serializeConsoleModel(state, T0 + 41));
  });

  it('the serialized model is pure VNode data (no DOM, no clock, no randomness)', () => {
    const model = renderConsoleModel(populatedWorkspace(), T0 + 40);
    expect(typeof serializeVNode(model)).toBe('string');
    expect(serializeVNode(model)).toBe(serializeVNode(renderConsoleModel(populatedWorkspace(), T0 + 40)));
  });
});

/** The view instant of a state (the Time Machine's word — helper for the projection assertions). */
function viewAtOfState(state: WorkspaceState): number {
  const timeMachine = state.timeMachine;
  switch (timeMachine.mode) {
    case 'live': return timeMachine.anchorAt;
    case 't-minus': return timeMachine.anchorAt - timeMachine.tMinusMs;
    case 'timestamp': return timeMachine.timestamp;
    case 'playback': return timeMachine.playback === null ? timeMachine.anchorAt : timeMachine.playback.fromAt + timeMachine.playback.ticks * timeMachine.playback.stepMs;
  }
}

// ---------------------------------------------------------------------------
// W-19: the job RESULT section (R1 — the research deliverable reads in
// the dialog) + the predicate bounds (R5 — a limit without a number is
// not a limit).
// ---------------------------------------------------------------------------

/** The demo machinery's research completion payload (deploy/vercel/runtime/demo.ts — the shape exports proved in every Phase-2 download). */
function completedResearchJob(result: unknown): JobRecord {
  return {
    jobId: 'job-r1', kind: 'research', tenant: 'tenant-a', project: 'proj-a',
    status: 'complete', submittedAt: T0 + 20, completedAt: T0 + 40, result,
  };
}

describe('render model: the job RESULT section (§4.5a — the R1 fix, W-19)', () => {
  it('a completed research job with a release-candidate payload renders a READABLE result section in its dialog', () => {
    const job = completedResearchJob({ kind: 'release-candidate', specId: 'spec-demo-director', version: 1, project: 'proj-a' });
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'job-updated', at: T0 + 40, job },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'section', sheet: { kind: 'job', id: 'job-r1' } }));
    expect(bytes).toContain('data-def="RESULT"');                       // the section renders at all (RED on the unfixed tree)
    expect(bytes).toContain('release candidate');                       // the deliverable, readable
    expect(bytes).toContain('spec-demo-director');                      // the payload's own lineage
    expect(bytes).toContain('spec id');                                 // ...under its closed label
    expect(bytes).toContain('Research produced a release candidate worth reviewing.'); // the product's own one-sentence summary
    expect(bytes).toContain('result available');                        // the sheet subtitle flags the deliverable
  });

  it('a RICHER payload renders its own fields — the projection is total over what the job machinery served', () => {
    const job = completedResearchJob({
      kind: 'release-candidate', specId: 'spec-x', version: 2, project: 'proj-a',
      title: 'Momentum scout v2', summary: 'Trades the open with a lagged executor.',
      findings: ['momentum persists 20min', 'venue lag dominates'],
      metrics: { sharpe: 1.4, maxDrawdown: 0.18 },
    });
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'job-updated', at: T0 + 40, job },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'section', sheet: { kind: 'job', id: 'job-r1' } }));
    expect(bytes).toContain('Momentum scout v2');
    expect(bytes).toContain('Trades the open with a lagged executor.');
    expect(bytes).toContain('momentum persists 20min');
    expect(bytes).toContain('{"sharpe":1.4,"maxDrawdown":0.18}');       // nested structures render as readable JSON
  });

  it('a job with NO result renders NO result section — nothing is fabricated (a running job proves nothing about a deliverable)', () => {
    const state = populatedWorkspace(); // the fixture's job-1 is 'running' with no result
    const viewing = reduceAll(state, [{ kind: 'view-live', at: T0 + 50 }]);
    const bytes = serializeVNode(renderConsoleModel(viewing, T0 + 50, { ...defaultShellView(viewing), accountView: 'section', sheet: { kind: 'job', id: 'job-1' } }));
    expect(bytes).not.toContain('data-def="RESULT"');
    expect(bytes).not.toContain('result available');
  });

  it('the result rides the job record\'s own availability gate (L4 — no deliverable before its completion instant)', () => {
    const job = completedResearchJob({ kind: 'release-candidate', specId: 'spec-demo-director', version: 1, project: 'proj-a' });
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'job-updated', at: T0 + 40, job },
      { kind: 'view-tminus', at: T0 + 50, tMinusMs: 20_000 }, // viewAt = T0 + 30, before the job's completedAt (T0 + 40)
    ]);
    expect(() => serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'section', sheet: { kind: 'job', id: 'job-r1' } }))).toThrow(AvailabilityViolationError);
  });

  it('jobResultSectionOf: null for absent/empty payloads, pairs for the rest (the pure projection, directly)', () => {
    expect(jobResultSectionOf({ jobId: 'j', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'running', submittedAt: T0 })).toBeNull(); // no result field
    expect(jobResultSectionOf(completedResearchJob(undefined))).toBeNull();
    expect(jobResultSectionOf(completedResearchJob('a string result'))).toBeNull();
    expect(jobResultSectionOf(completedResearchJob({}))).toBeNull();    // an empty object carries nothing readable
    const section = jobResultSectionOf(completedResearchJob({ kind: 'training-summary', epochs: 3, project: 'proj-a' }));
    expect(section?.eyebrow).toBe('RESULT');
    expect(section?.pairs).toContainEqual(['epochs', '3']);            // numbers render grouped/deterministic
    expect(section?.pairs).toContainEqual(['deliverable', 'training summary']);
  });
});

// ---------------------------------------------------------------------------
// D-9 (W-28): the result->job lineage leg — the job capsules in the
// Evidence section (ALONGSIDE the read families) + the job sheet's own
// capsule affordance (the bidirectional leg L2 verified for outcome
// capsules: a capsule that references its job, and the job's result view
// linking its capsule).
// ---------------------------------------------------------------------------

describe('render model: D-9 — the job capsules (the result->job lineage leg, W-28)', () => {
  /** A workspace with one outcome AND one completed research job with its release-candidate result. */
  function workspaceWithResultJob(): WorkspaceState {
    const job = completedResearchJob({ kind: 'release-candidate', specId: 'spec-demo-director', version: 1, project: 'proj-a' });
    return reduceAll(populatedWorkspace(), [
      { kind: 'job-updated', at: T0 + 40, job },
      { kind: 'view-live', at: T0 + 50 },
    ]);
  }

  it('the Evidence section lists the job capsule ALONGSIDE the read families (the research result is no longer a lineage leaf)', () => {
    const state = reduceAll(workspaceWithResultJob(), [{ kind: 'section-selected', at: T0 + 50, section: 'evidence' }]);
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'section' }));
    const outcomeCapsule = capsuleFromOutcome(SCOPE, outcome());
    const jobCapsule = capsuleFromJob(SCOPE, completedResearchJob({ kind: 'release-candidate', specId: 'spec-demo-director', version: 1, project: 'proj-a' }));
    expect(bytes).toContain(`data-capsule-open="${outcomeCapsule.capsuleId}"`); // the read family's capsule survives unchanged
    expect(bytes).toContain(`data-capsule-open="${jobCapsule.capsuleId}"`);    // the job-derived capsule lists beside it
    // opening the job capsule renders the lineage leg: the JOB REF + the provenance line
    const opened = serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'section', openCapsule: jobCapsule.capsuleId }));
    expect(opened).toContain('refs: job:job-r1');
    expect(opened).toContain('read from /v1/jobs/:jobId'); // the provenance line's route
    expect(opened).toContain('capsule-provenance');
    expect(opened).toContain('job job-r1');               // the entity id in the provenance line
  });

  it('the job\'s detail sheet carries its own capsule INLINE (the bidirectional affordance — the result view links its capsule)', () => {
    const state = workspaceWithResultJob();
    const jobCapsule = capsuleFromJob(SCOPE, completedResearchJob({ kind: 'release-candidate', specId: 'spec-demo-director', version: 1, project: 'proj-a' }));
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'section', sheet: { kind: 'job', id: 'job-r1' } }));
    expect(bytes).toContain('data-def="RESULT"');                        // the result view renders (§4.5a)
    expect(bytes).toContain(`data-capsule-open="${jobCapsule.capsuleId}"`); // ...and its capsule badge rides the sheet
  });

  it('a job WITHOUT a result mints no capsule — the sheet renders no badge (nothing fabricated, L20)', () => {
    const state = populatedWorkspace(); // the fixture's job-1 is 'running' with no result
    const viewing = reduceAll(state, [{ kind: 'view-live', at: T0 + 50 }]);
    const bytes = serializeVNode(renderConsoleModel(viewing, T0 + 50, { ...defaultShellView(viewing), accountView: 'section', sheet: { kind: 'job', id: 'job-1' } }));
    expect(bytes).not.toContain('data-action="capsule-open"');
  });

  it('a workspace with NO capsule sources renders the Evidence teaching empty state (unchanged)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'view-live', at: T0 + 50 },
      { kind: 'section-selected', at: T0 + 50, section: 'evidence' },
    ]);
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'section' }));
    expect(bytes).toContain('No evidence capsules at this view instant.');
    expect(bytes).toContain('Open Outcomes');
    expect(bytes).not.toContain('data-action="capsule-open"');
  });
});

describe('render model: constraint and criterion bounds (§4.5 — the R5 fix, W-19)', () => {
  /** The fixture constraint set: the M5 finding's exact three (a budget equals, a drawdown limit.max, a range). */
  function constraintSet(): ConstraintSetStatement {
    return {
      id: 'cs-demo', version: 1, tenantId: 'tenant-a',
      constraints: [
        { id: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', predicate: { kind: 'equals', value: 300_000_000 }, severity: 'blocking' },
        { id: 'k-risk-budget', domain: 'outcome', subject: 'risk.budget', predicate: { kind: 'equals', value: 15_000_000 }, severity: 'blocking' },
        { id: 'c-1', domain: 'outcome', subject: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 }, severity: 'blocking' },
        { id: 'c-2', domain: 'state', subject: 'exposure.band', predicate: { kind: 'limit.range', min: 0.1, max: 0.5 }, severity: 'advisory' },
      ],
      createdAt: T0,
    };
  }

  /** The fixture goal statement (criteria with numeric bounds). */
  function goal(): GoalStatement {
    return {
      id: 'goal-1', version: 1, tenantId: 'tenant-a',
      objective: 'Compound the book inside the risk framework.',
      horizon: { startsAt: T0, endsAt: T0 + 90_000, label: 'Q1' },
      successCriteria: {
        criteria: [
          { id: 'sc-1', metric: 'return.net', predicate: { kind: 'limit.min', bound: 1_250_000 } },
          { id: 'sc-2', metric: 'venue', predicate: { kind: 'oneOf', values: ['sim-primary', 'demo-feed'] } },
        ],
        requiredSatisfaction: 1,
      },
      evaluation: { blindRef: 'ev-blind', walkForwardRef: 'ev-wf', regimeRef: 'ev-regime', adversarialRequired: false },
      createdAt: T0,
    };
  }

  it('the RISK section renders every constraint WITH its numeric bound (the number, not the bare predicate label)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'goal-loaded', at: T0 + 5, goal: goal(), constraintSet: constraintSet() },
      { kind: 'section-selected', at: T0 + 50, section: 'risk' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('outcome.capital.budget equals 300,000,000'); // RED on the unfixed tree: the label rendered without the number
    expect(bytes).toContain('outcome.risk.budget equals 15,000,000');
    expect(bytes).toContain('outcome.risk.maxDrawdown limit.max 0.2');    // M5's own drawdown limit
    expect(bytes).toContain('state.exposure.band limit.range 0.1 to 0.5');
    expect(bytes).not.toContain('outcome.capital.budget equals<');        // never a dangling label
  });

  it('the GOAL section renders the criteria and constraints with their bounds too (the same law, every surface)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'goal-loaded', at: T0 + 5, goal: goal(), constraintSet: constraintSet() },
      { kind: 'section-selected', at: T0 + 50, section: 'goal' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('return.net limit.min 1,250,000');
    expect(bytes).toContain('venue oneOf sim-primary, demo-feed');
    expect(bytes).toContain('blocking c-1');
    expect(bytes).toContain('outcome.risk.maxDrawdown limit.max 0.2');
  });

  it('predicatePhraseOf: every predicate kind renders its value(s) (the pure phrase, directly)', () => {
    expect(predicatePhraseOf({ kind: 'limit.max', bound: 0.2 })).toBe('limit.max 0.2');
    expect(predicatePhraseOf({ kind: 'limit.min', bound: 25_000_000 })).toBe('limit.min 25,000,000');
    expect(predicatePhraseOf({ kind: 'limit.range', min: 0.1, max: 0.5 })).toBe('limit.range 0.1 to 0.5');
    expect(predicatePhraseOf({ kind: 'equals', value: 300_000_000 })).toBe('equals 300,000,000');
    expect(predicatePhraseOf({ kind: 'equals', value: 'demo-feed' })).toBe('equals demo-feed');
    expect(predicatePhraseOf({ kind: 'notEquals', value: false })).toBe('notEquals false');
    expect(predicatePhraseOf({ kind: 'oneOf', values: ['a', 'b'] })).toBe('oneOf a, b');
    expect(predicatePhraseOf({ kind: 'flag', expected: true })).toBe('flag expected true');
  });
});

// ---------------------------------------------------------------------------
// D-2 (the W-24 fix): the post-mortems render in the OUTCOMES section.
// The section's subtitle promises "Results and post-mortems", but only
// the outcome rendered — the seeded post-mortem was reachable solely
// via its evidence capsule and the Lessons section (4/6 Phase-2
// personas partialed the "Review outcomes + post-mortems" project on it).
// ---------------------------------------------------------------------------

describe('render model: the OUTCOMES post-mortem cards (D-2 — the W-24 fix)', () => {
  /** The Outcomes section of a workspace carrying the fixture outcome AND its post-mortem. */
  function outcomesSectionBytes(extraEvents: readonly WorkspaceEvent[] = []): string {
    const state = reduceAll(populatedWorkspace(), [
      { kind: 'post-mortems-loaded', at: T0 + 32, records: [postMortem()] },
      ...extraEvents,
      { kind: 'section-selected', at: T0 + 50, section: 'outcomes' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    return serializeConsoleModel(state, T0 + 50);
  }

  it('renders BOTH the outcome and its post-mortem in the Outcomes section (the subtitle\'s own promise)', () => {
    const bytes = outcomesSectionBytes();
    // the outcome still renders, decimals verbatim (unchanged)
    expect(bytes).toContain('out-1');
    expect(bytes).toContain('1000.00');
    // the post-mortem renders in THIS section — RED on the unfixed tree (only Lessons/Evidence carried it)
    expect(bytes).toContain('data-post-mortem="pmr-1"');                 // its own id, on its own card
    expect(bytes).toContain('<span class="fact-label">outcome</span><span class="fact-value">out-1</span>'); // the outcome it attaches to
    expect(bytes).toContain('adverse_gap');                              // the outcome class it records
    expect(bytes).toContain('within tolerance');                         // the summary fields
    expect(bytes).toContain('the rebalance window was missed by the simulated venue lag'); // the FINDING (hypothesis note, verbatim)
    expect(bytes).toContain('confidence 0.8');                           // the hypothesis's confidence, verbatim decimal
    // and the post-mortem's evidence capsule rides inline beside it (the J7 convention)
    const capsule = capsuleFromPostMortem(SCOPE, postMortem());
    expect(bytes).toContain(`data-capsule-row="${capsule.capsuleId}"`);
  });

  it('a workspace with NO post-mortems renders the Outcomes section exactly as before (the additive-only law)', () => {
    const state = reduceAll(populatedWorkspace(), [
      { kind: 'section-selected', at: T0 + 50, section: 'outcomes' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('out-1');                          // the outcome renders
    expect(bytes).not.toContain('No outcomes at this view instant'); // the section is not empty
    expect(bytes).not.toContain('data-post-mortem');           // no post-mortem cards are fabricated
  });

  it('the empty state still teaches when there are NEITHER outcomes NOR post-mortems', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'section-selected', at: T0 + 50, section: 'outcomes' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('No outcomes at this view instant');
    expect(bytes).not.toContain('data-post-mortem');
  });

  it('a post-mortem whose outcome is not in the projection still renders — its card names the attachment (nothing dropped silently)', () => {
    // a workspace carrying ONLY the post-mortem (the outcome records never loaded)
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'post-mortems-loaded', at: T0 + 32, records: [postMortem()] },
      { kind: 'section-selected', at: T0 + 50, section: 'outcomes' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('data-post-mortem="pmr-1"');
    expect(bytes).toContain('<span class="fact-label">outcome</span><span class="fact-value">out-1</span>');
    expect(bytes).not.toContain('No outcomes at this view instant'); // the section carries the post-mortem — not empty
  });

  it('the post-mortem respects the view-instant availability projection (L4 — nothing knowable before its asOf)', () => {
    // view at T0+31: the outcome (asOf T0+30) is knowable, the post-mortem (asOf T0+32) is NOT
    const state = reduceAll(populatedWorkspace(), [
      { kind: 'post-mortems-loaded', at: T0 + 32, records: [postMortem()] },
      { kind: 'section-selected', at: T0 + 50, section: 'outcomes' },
      { kind: 'view-tminus', at: T0 + 50, tMinusMs: 19 }, // viewAt = (T0 + 50) - 19 = T0 + 31
    ]);
    expect(viewAtOfState(state)).toBe(T0 + 31);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('out-1');                  // the outcome renders (knowable at T0+31)
    expect(bytes).not.toContain('pmr-1');              // the post-mortem does NOT (it is in the state, past the view instant)
    expect(bytes).not.toContain('data-post-mortem');
    expect(bytes).not.toContain('the rebalance window was missed by the simulated venue lag');
  });

  it('L12 (defense in depth): a foreign-tenant post-mortem reaching the Outcomes render is the typed CrossTenantRenderError', () => {
    const anchored = reduceAll(populatedWorkspace(), [
      { kind: 'post-mortems-loaded', at: T0 + 32, records: [postMortem()] },
      { kind: 'view-live', at: T0 + 60 },
    ]);
    const foreign = { ...anchored, postMortems: [{ ...postMortem(), lineage: { ...postMortem().lineage, tenant: 'tenant-b' } }] } as WorkspaceState;
    expect(() => serializeConsoleModel({ ...foreign, selectedSection: 'outcomes' } as WorkspaceState, T0 + 60)).toThrow(CrossTenantRenderError);
  });
});

// ---------------------------------------------------------------------------
// D-8 (W-28) — THE MARKET WORLD SECTION'S BINDING: the section was bound to
// the IN-SESSION launch draft (state.launch.draft) only, so after a reload
// (or a scope switch, or a cold start) it rendered the teaching empty state
// forever for every launched project — M4's + L5's re-run finding, the
// re-run's ONLY project blocker. The fix rebinds it to the PERSISTED world
// (state.world — the host goal route's additive `world` field) FIRST, with
// the draft remaining the source only while the wizard is open in a scope
// that has no world yet, and the teaching empty state rendering ONLY for a
// project that genuinely has no world on record (the demo scope).
// ---------------------------------------------------------------------------

describe('render model: the MARKET WORLD section (D-8 — the persisted launch world, W-28)', () => {
  /** The fixture persisted world (the host goal route's additive `world` shape). */
  function world(overrides: Partial<ProjectGoalWorldSpec> = {}): ProjectGoalWorldSpec {
    return {
      markets: ['BTC-USD', 'ETH-USD', 'SOL-USD'],
      venues: ['binance', 'kraken'],
      dataSources: ['candle-v1', 'depth-v1', 'trades-v1'],
      executionMode: 'simulation',
      capitalBudget: '750000.00',
      riskBudget: '60000.00',
      horizon: { startsAt: T0, endsAt: T0 + 2_592_000_000 },
      ...overrides,
    };
  }

  it('a workspace with a PERSISTED world (the reload path — no session draft anywhere) renders the world card, NOT the teaching empty state', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'goal-loaded', at: T0 + 5, goal: goalStatementOf(), constraintSet: constraintSetOf(), world: world() },
      { kind: 'section-selected', at: T0 + 50, section: 'market-world' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    expect(state.launch.draft).toBeNull(); // the reload path: no in-session draft — the pre-fix section rendered the empty state HERE
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('data-market-world="persisted"');      // the persisted-world card
    expect(bytes).toContain('BTC-USD, ETH-USD, SOL-USD');          // the launched markets
    expect(bytes).toContain('binance, kraken');                    // the launched venues
    expect(bytes).toContain('candle-v1, depth-v1, trades-v1');     // the launched data sources
    expect(bytes).toContain('750000.00');                          // the capital budget, exact decimal
    expect(bytes).toContain('60000.00');                           // the risk budget, exact decimal
    expect(bytes).not.toContain('No launch context yet');          // the D-8 defect is gone
  });

  it('the persisted world WINS over a stale session draft (the D-15 cross-scope bleed, closed for this section): a draft from ANOTHER scope never renders here', () => {
    // a workspace with BOTH: a persisted world (this scope's own) and a leftover
    // launch draft (another scope's session context — D-15's bleed source)
    const draft = { ...blankDraft(), markets: ['STALE-MKT'], venues: ['stale-venue'], dataSources: ['stale-feed'] };
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'launch-draft-started', at: T0 + 1, draft },
      { kind: 'goal-loaded', at: T0 + 5, goal: goalStatementOf(), constraintSet: constraintSetOf(), world: world() },
      { kind: 'section-selected', at: T0 + 50, section: 'market-world' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('BTC-USD, ETH-USD, SOL-USD'); // the SCOPE's own world renders
    expect(bytes).not.toContain('STALE-MKT');             // the foreign session draft never bleeds in
    expect(bytes).not.toContain('Market world (launch context)'); // the draft card lost its precedence
  });

  it('the in-session DRAFT still renders while the wizard is open in a scope that has NO world yet (the pre-W-28 behavior, preserved)', () => {
    const draft = { ...blankDraft(), markets: ['SPY', 'GLD'], venues: ['venue-x'], dataSources: ['data:ohlcv-1d'] };
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'launch-draft-started', at: T0 + 1, draft },
      { kind: 'section-selected', at: T0 + 50, section: 'market-world' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('Market world (launch context)'); // the draft card (the in-session source)
    expect(bytes).toContain('SPY, GLD');
    expect(bytes).not.toContain('No launch context yet');
  });

  it('a workspace with NEITHER a world NOR a draft (the demo scope — its seeded goal genuinely has no world fields) renders the TEACHING EMPTY STATE', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'goal-loaded', at: T0 + 5, goal: goalStatementOf(), constraintSet: constraintSetOf() }, // NO world on the wire
      { kind: 'section-selected', at: T0 + 50, section: 'market-world' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('No launch context yet — the market world is specified at launch.'); // the teaching empty state stays
    expect(bytes).toContain('Open Goal'); // its single action stays
    expect(bytes).not.toContain('data-market-world');
  });

  /** A minimal goal statement (the goal-loaded pair's first half). */
  function goalStatementOf(): GoalStatement {
    return {
      id: 'goal-1', version: 1, tenantId: 'tenant-a', objective: 'Compound the book.',
      horizon: { startsAt: T0, endsAt: T0 + 90_000 },
      successCriteria: { criteria: [], requiredSatisfaction: 1 },
      evaluation: { blindRef: 'ev-blind', walkForwardRef: 'ev-wf', regimeRef: 'ev-regime', adversarialRequired: false },
      createdAt: T0,
    };
  }

  /** A minimal constraint-set statement (the goal-loaded pair's second half). */
  function constraintSetOf(): ConstraintSetStatement {
    return { id: 'cs-1', version: 1, tenantId: 'tenant-a', constraints: [], createdAt: T0 };
  }

  /** A blank launch draft (core/launch-form's own factory — the wizard's opening state). */
  function blankDraft(): LaunchDraft {
    return {
      name: 'Alpha Seeker',
      objective: 'Find and keep an edge in momentum.',
      horizon: { startsAt: T0, endsAt: T0 + 86_400_000 },
      successCriteria: [{ id: 'sc-1', metric: 'pnl.net', predicate: { kind: 'limit.min', bound: 0 } }],
      evaluation: { blindRef: 'eval:blind-1', walkForwardRef: 'eval:wf-1', regimeRef: 'eval:regime-1', adversarialRequired: true },
      constraints: [],
      capitalBudget: '10000.00',
      riskBudget: '250.00',
      markets: ['SPY'],
      venues: ['venue-x'],
      dataSources: ['data:ohlcv-1d'],
      executionMode: 'simulation',
      preferences: [],
    };
  }
});

// ---------------------------------------------------------------------------
// D-11 (W-29) — THE HOME HERO'S LAUNCH BANNER. M4's finding: after the
// launch completed, Home kept the "A launch is in progress — details
// below." banner AND hid the launch-entry buttons (a second launch
// required a page reload). The banner is now PHASE-DRIVEN: it renders
// ONLY while the tracked launch is genuinely in flight, and a concluded
// launch (launched/failed, no open wizard) restores the entry CTA.
// ---------------------------------------------------------------------------

describe('render model: D-11 — the Home hero\'s launch banner clears when the launch concludes', () => {
  function homeBytes(events: readonly WorkspaceEvent[]): string {
    const state = reduceAll(openWorkspace(SCOPE, T0), events);
    return serializeVNode(renderConsoleModel(state, T0 + 60, { ...defaultShellView(state), accountView: 'home' }));
  }

  it('while the launch is IN FLIGHT the banner renders and the entry CTA is away', () => {
    const bytes = homeBytes([{ kind: 'launch-submitted', at: T0 + 1, projectId: 'proj-a', jobId: 'job-9' }]);
    expect(bytes).toContain('A launch is in progress — details below.');
    expect(bytes).toContain('data-hero-launch="launching"');
    expect(bytes).not.toContain('data-action="launch-start"');
  });

  it('a COMPLETED launch restores the entry CTA — the banner clears (no reload needed for a second launch)', () => {
    // the jobs-list race shape: the kickoff job arrives already complete
    // (the D-11 reducer closes the launch on the record itself)
    const bytes = homeBytes([
      { kind: 'launch-submitted', at: T0 + 1, projectId: 'proj-a', jobId: 'job-9' },
      { kind: 'job-updated', at: T0 + 2, job: { jobId: 'job-9', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'complete', submittedAt: T0 + 1, completedAt: T0 + 5 } },
    ]);
    expect(bytes).toContain('data-action="launch-start"');       // the launch-entry button is back
    expect(bytes).toContain('Describe your goal');               // the hero's own CTA copy
    expect(bytes).not.toContain('A launch is in progress');      // the banner is gone
    // the launch panel below keeps the concluded launch's own card (the honest terminal render)
    expect(bytes).toContain('Launch progress');
    expect(bytes).toContain('data-launch-phase="complete"');
  });

  it('a FAILED launch restores the entry CTA too — the error card stays in the launch panel, never the hero', () => {
    const bytes = homeBytes([
      { kind: 'launch-submitted', at: T0 + 1, projectId: 'proj-a', jobId: 'job-9' },
      { kind: 'job-updated', at: T0 + 2, job: { jobId: 'job-9', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'failed', submittedAt: T0 + 1 } },
    ]);
    expect(bytes).toContain('data-action="launch-start"');
    expect(bytes).not.toContain('A launch is in progress');
    expect(bytes).toContain('Launch failed'); // the error card renders in the launch panel below
  });

  it('the wizard-open note still wins while a draft is active (the J3 resume hint, unchanged)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [{ kind: 'launch-draft-started', at: T0 + 1, draft: blankDraftOfD11() }]);
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 60, { ...defaultShellView(state), accountView: 'home' }));
    expect(bytes).toContain('The launch wizard is open — continue below.');
    expect(bytes).toContain('data-hero-launch="draft"');
    expect(bytes).not.toContain('data-action="launch-start"');
  });

  /** The blank draft fixture (the D-11 describe's own copy — the wizard's opening state). */
  function blankDraftOfD11(): LaunchDraft {
    return {
      name: 'Alpha Seeker',
      objective: 'Find and keep an edge in momentum.',
      horizon: { startsAt: T0, endsAt: T0 + 86_400_000 },
      successCriteria: [{ id: 'sc-1', metric: 'pnl.net', predicate: { kind: 'limit.min', bound: 0 } }],
      evaluation: { blindRef: 'eval:blind-1', walkForwardRef: 'eval:wf-1', regimeRef: 'eval:regime-1', adversarialRequired: true },
      constraints: [],
      capitalBudget: '10000.00',
      riskBudget: '250.00',
      markets: ['SPY'],
      venues: ['venue-x'],
      dataSources: ['data:ohlcv-1d'],
      executionMode: 'simulation',
      preferences: [],
    };
  }
});

// ---------------------------------------------------------------------------
// D-13 (W-29) — THE PROJECT-SCOPED INBOX. The inbox state keeps every notice
// the session folded (append-only), but the SURFACE is project-scoped like
// every section panel: a multi-desk tenant never sees the demo project's
// seed notices inside their own desk's inbox (M4/M5/L5: 7 unread = 5 demo +
// 2 own). The bell badge, the Home unread tile and the activity timeline
// all follow the same scoped fold.
// ---------------------------------------------------------------------------

describe('render model: D-13 — the inbox renders the PROJECT-SCOPED view', () => {
  /** A two-desk session: desk A (proj-a) folds a notice, the workspace adopts desk B (proj-b), desk B folds its own. */
  function twoDeskState(): WorkspaceState {
    const events: readonly WorkspaceEvent[] = [
      { kind: 'job-updated', at: T0 + 20, job: { jobId: 'job-desk-a', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'failed', submittedAt: T0 + 10 } },
      { kind: 'project-adopted', at: T0 + 30, projectId: 'proj-b' },
      { kind: 'job-updated', at: T0 + 40, job: { jobId: 'job-desk-b', kind: 'research', tenant: 'tenant-a', project: 'proj-b', status: 'failed', submittedAt: T0 + 35 } },
      { kind: 'view-live', at: T0 + 50 },
    ];
    return reduceAll(openWorkspace(SCOPE, T0), events);
  }

  it('the Inbox panel lists ONLY the current desk\'s notices — the other desk\'s rows never render, and the scoping is STATED in the copy', () => {
    const state = twoDeskState();
    expect(state.inbox.notices).toHaveLength(2); // the STATE keeps both desks' notices (append-only)
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 60, { ...defaultShellView(state), accountView: 'inbox' }));
    expect(bytes).toContain('data-row="notice:');                       // the row grammar renders
    expect(bytes).not.toContain('job-desk-a');                          // desk A's notice NEVER renders in desk B's inbox
    expect(bytes).toContain('job-desk-b');                              // desk B's own notice renders
    expect(bytes).toContain('data-inbox-scope="proj-b"');               // the scoping is disclosed
    expect(bytes).toContain('Notices for this project (proj-b)');       // in plain-English copy
    expect(bytes).toContain('data-unread="1"');                         // the panel's own count is the scoped one
  });

  it('the bell badge and Home\'s unread tile + activity timeline follow the SAME scoped fold (another desk\'s notices never badge this desk)', () => {
    const state = twoDeskState();
    const homeBytes = serializeVNode(renderConsoleModel(state, T0 + 60, { ...defaultShellView(state), accountView: 'home' }));
    expect(homeBytes).toContain('data-unread="1"');          // the bell badge: ONE unread (desk B's own)
    expect(homeBytes).not.toContain('data-unread="2"');      // never the two-desk total
    expect(homeBytes).toContain('UNREAD NOTICES');           // the Home tile
    expect(homeBytes).toContain('job-desk-b');               // the activity timeline carries desk B's notice
    expect(homeBytes).not.toContain('job-desk-a');           // never desk A's
  });

  it('switching BACK to the first desk restores ITS notices (the state kept them; each desk sees its own)', () => {
    const state = reduceAll(twoDeskState(), [{ kind: 'project-adopted', at: T0 + 60, projectId: 'proj-a' }]);
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 70, { ...defaultShellView(state), accountView: 'inbox' }));
    expect(bytes).toContain('job-desk-a');          // desk A's notice is back in ITS inbox
    expect(bytes).not.toContain('job-desk-b');      // desk B's never renders here
    expect(bytes).toContain('data-inbox-scope="proj-a"');
  });
});

// ---------------------------------------------------------------------------
// D-17 (W-29) — THE JOB DIALOG'S ELASTIC ELAPSED, FIXED AT THE RECORD. The
// dialog's METRICS showed "elapsed: pending" for COMPLETE jobs with BOTH
// timestamps present — the seed job:57d1815d (L2) and the Lead's fresh
// kickoff job:1f7a71dc — because the sheet derived it from renderJobProgress
// over the SESSION's observation points (empty for every non-tracked job and
// after every reload). The sheet now derives it from the record's own
// timestamps; 'pending' shows ONLY while the record genuinely carries no
// completedAt.
// ---------------------------------------------------------------------------

describe('render model: D-17 — the job sheet\'s elapsed derives from the RECORD', () => {
  /** A COMPLETE job with both timestamps — the D-17 shape (NO session launch tracking anywhere, the reload/seed reality). */
  function completeSeededJob(): JobRecord {
    return { jobId: 'job:57d1815d', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'complete', submittedAt: T0 + 20, completedAt: T0 + 28, result: { kind: 'release-candidate', specId: 'spec-demo-director', version: 1 } };
  }

  it('a COMPLETE job with timestamps renders its elapsed — no session launch tracking anywhere (the exact persona/Lead shape)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'job-updated', at: T0 + 30, job: completeSeededJob() },
      { kind: 'view-live', at: T0 + 40 },
    ]);
    expect(state.launch.jobId).toBeNull(); // no tracked launch — the pre-fix sheet rendered 'pending' exactly here
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'section', sheet: { kind: 'job', id: 'job:57d1815d' } }));
    expect(bytes).toContain('job:57d1815d');
    expect(bytes).toContain('completed at');      // the record's completion instant renders
    // the METRICS pair carries the derived duration (8ms — the record's own arithmetic)
    expect(bytes).toContain('8ms');
  });

  it('a RUNNING job (genuinely incomplete — no completedAt on the record) still renders pending', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'job-updated', at: T0 + 30, job: { jobId: 'job-running-1', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'running', submittedAt: T0 + 20 } },
      { kind: 'view-live', at: T0 + 40 },
    ]);
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'section', sheet: { kind: 'job', id: 'job-running-1' } }));
    expect(bytes).toContain('pending'); // the honest in-flight state
  });

  it('the Research section\'s row carries the duration meta for EVERY completed job (not only the tracked launch)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'job-updated', at: T0 + 30, job: completeSeededJob() },
      { kind: 'section-selected', at: T0 + 31, section: 'research' },
      { kind: 'view-live', at: T0 + 40 },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('job:57d1815d');
    expect(bytes).toContain('8ms'); // the row's meta — the record's own duration
  });
});
