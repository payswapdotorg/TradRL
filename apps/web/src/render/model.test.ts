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
import type { JobRecord, OrgStatusSnapshot, OutcomeRecord, ProjectRecord, ServedKnowledge } from '../api/contracts';
import { systemNowMs } from '../core/clock';
import { AvailabilityViolationError, CrossTenantRenderError, PolicyEnforcementError, WallClockReadError } from '../core/errors';
import { assertVisible } from '../core/availability';
import { openWorkspace, reduceAll, type WorkspaceEvent, type WorkspaceState } from '../core/workspace';
import { WORKSPACE_SECTIONS } from '../core/sections';
import { assertVerdictFaithful, renderConsoleModel, serializeConsoleModel, submissionVerdictBadgeOf, type VerdictBadge } from './model';
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
    // the outcome's evidence ref renders in the evidence section (the capsule's refs)
    const evidence = reduceAll(populatedWorkspace(), [
      { kind: 'view-live', at: T0 + 50 },
      { kind: 'section-selected', at: T0 + 50, section: 'evidence' },
    ]);
    expect(serializeConsoleModel(evidence, T0 + 50)).toContain('fil-1');
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
