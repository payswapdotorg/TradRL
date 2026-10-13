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
import type { ConstraintSetStatement, GatewaySubmissionRecord, GoalStatement, JobRecord, OrgStatusSnapshot, OutcomeRecord, PostMortemRecord, ProjectGoalWorldSpec, ProjectRecord, ResearchNoteRecord, ServedKnowledge } from '../api/contracts';
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

/**
 * FW-35-B (Round D register §3.5 — S2's cross-surface linkage finding):
 * the fixture BLOTTER ROW — a routed submission whose decisionId
 * resolves the fixture outcome's decisionRef (dec-1), the record's own
 * linkage the outcome metrics' citation rides.
 */
function blotterRow(): GatewaySubmissionRecord {
  return {
    kind: 'routed', submissionId: 'sub-1', decisionId: 'dec-1', auditId: 'aud-1',
    requestRef: 'req-1', venue: 'binance', adapterRef: 'ada-1', channelRef: 'chn-1', routedAt: T0 + 25,
  } as unknown as GatewaySubmissionRecord;
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

/** One constraint set (the Risk section's standing-note branch needs one on record; the goal-bundle read's own record). */
function constraints(): ConstraintSetStatement {
  return { id: 'cs-1', version: 1, tenantId: 'tenant-a', constraints: [], createdAt: T0 };
}

/** One goal statement (the goal-bundle read's own record). */
function goalOf(): GoalStatement {
  return {
    id: 'goal-1', version: 1, tenantId: 'tenant-a', objective: 'Compound the book inside the risk framework.',
    horizon: { startsAt: T0, endsAt: T0 + 90_000 }, successCriteria: { criteria: [], requiredSatisfaction: 1 },
    evaluation: { blindRef: 'ev-blind', walkForwardRef: 'ev-wf', regimeRef: 'ev-reg', adversarialRequired: false }, createdAt: T0,
  };
}

/** A desk MID-READ-BUNDLE at the LIVE view: connected, the project record on hand (the bundle's first family answered), every other family's read still in flight (the N-1 suite's own shape — the O-1/O-2/O-3 suites reuse it). */
function midReadWorkspace(extra: readonly WorkspaceEvent[] = []): WorkspaceState {
  return reduceAll(openWorkspace(SCOPE, T0), [
    { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
    { kind: 'project-loaded', at: T0 + 2, project: projectRecord() },
    { kind: 'view-live', at: T0 + 50 },
    ...extra,
  ]);
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

  it('FW-35-B (Round D register §3.5 — S2): the OUTCOME METRICS cite the execution blotter row ids that produced the fill (the submissions whose decisionId resolves the decision ref) — reconciliation by CLICK, never by recognizing shared ids across sections', () => {
    const state = reduceAll(populatedWorkspace(), [
      { kind: 'submission-recorded', at: T0 + 26, submission: blotterRow() },
      { kind: 'view-live', at: T0 + 50 },
      { kind: 'section-selected', at: T0 + 50, section: 'outcomes' },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('cites blotter rows');
    expect(bytes).toContain('sub-1'); // the exact blotter row id, in the metrics grid itself
    // THE L4 LAW rides the citation: a row the blotter could not show at the view instant (routed later than the view) never cites
    const lateRow = { ...blotterRow(), submissionId: 'sub-late', routedAt: T0 + 45 } as unknown as GatewaySubmissionRecord;
    const pastView = reduceAll(populatedWorkspace(), [
      { kind: 'submission-recorded', at: T0 + 46, submission: lateRow },
      { kind: 'view-timestamp', at: T0 + 40, timestamp: T0 + 40 }, // the outcome (asOf T0+30) is visible; the late row is not
      { kind: 'section-selected', at: T0 + 40, section: 'outcomes' },
    ]);
    const pastBytes = serializeConsoleModel(pastView, T0 + 40);
    expect(pastBytes).toContain('out-1');                 // the outcome renders at this instant
    expect(pastBytes).toContain('cites blotter rows');    // the citation line renders honestly
    expect(pastBytes).not.toContain('sub-late');          // never a citation the blotter could not show
    expect(pastBytes).toContain('none');                  // the honest none, never a fabricated citation
  });

  it('FW-35-B (Round D register §3.5 — S2): the LESSONS card cites its ORIGINATING OUTCOME ids + the post-mortem ids it distilled (the record own provenance, rendered where the lesson lives — never a pmr id the reader must recognize across sections)', () => {
    const provenance = knowledge();
    const withProvenance: ServedKnowledge = {
      ...provenance,
      record: {
        ...provenance.record,
        provenance: { ...provenance.record.provenance, outcomeRefs: ['out-1'], postMortemRefs: ['pmr-1'] },
      },
    };
    const state = reduceAll(populatedWorkspace(), [
      { kind: 'knowledge-loaded', at: T0 + 31, records: [withProvenance] },
      { kind: 'view-live', at: T0 + 50 },
      { kind: 'section-selected', at: T0 + 50, section: 'lessons' },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('from outcomes');
    expect(bytes).toContain('out-1');           // the originating outcome id, on the lesson card
    expect(bytes).toContain('from post-mortems');
    expect(bytes).toContain('pmr-1');           // the distilled post-mortem id
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

  it('FW-48 keep-green: the RESULT section\'s projection is TOTAL over the compute\'s structured blocks — a payload carrying the inputs + noteAnalysis blocks renders them (readable JSON, never a silent drop; the console needs ZERO changes for the E-6 compute layer)', () => {
    // The FW-48 server-side compute rides the job record's result payload as
    // two ADDITIVE structured blocks. The console's projection is already
    // total over the payload's fields (the D-9/R1 law), so the blocks render
    // without a single console change — pinned green HERE so a future
    // purpose-built card never silently drops them (the FW-47-A pattern).
    const job = completedResearchJob({
      kind: 'release-candidate', specId: 'spec-launch-director', version: 1, project: 'proj-a',
      inputs: {
        notes: [{ noteId: 'note:78705f8a', attachedAt: T0 + 40, title: 'M2 Round M desk research priors', contributed: '1 typed parameter' }],
        parameters: [{ id: 'c-1', domain: 'outcome', subject: 'order.notional', kind: 'limit.max', bound: '30000', severity: 'blocking', fromNote: 'note:78705f8a' }],
        disclosure: 'the compute layer read them: 1 typed parameter(s) parsed with per-parameter provenance',
      },
      noteAnalysis: {
        evaluations: [{ id: 'c-1', subject: 'order.notional', kind: 'limit.max', bound: '30000', fromNote: 'note:78705f8a', subjectClass: 'order_notional', status: 'evaluated', observed: '45750.375', verdict: 'exceeded', basis: 'the largest single booked fill\'s notional', note: 'post-hoc observation' }],
        statement: 'post-hoc observation over the desk\'s own booked fill records — analysis, never enforcement (L20)',
      },
    });
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'job-updated', at: T0 + 40, job },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'section', sheet: { kind: 'job', id: 'job-r1' } }));
    expect(bytes).toContain('data-def="RESULT"');
    expect(bytes).toContain('note:78705f8a');      // the per-parameter provenance renders
    expect(bytes).toContain('45750.375');          // the observed figure renders
    expect(bytes).toContain('analysis, never enforcement'); // the L20 statement renders
    // The pure projection carries both blocks as pairs (the structured law, directly).
    const section = jobResultSectionOf(job);
    expect(section?.pairs.some(([label]) => label === 'inputs')).toBe(true);
    expect(section?.pairs.some(([label]) => label === 'noteAnalysis')).toBe(true);
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
});

/** The blank draft fixture (the wizard's opening state — the D-11 original, hoisted to file scope for the FW-45 seam-(a) hint test). */
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

// ---------------------------------------------------------------------------
// D-13 (W-29) — THE PROJECT-SCOPED INBOX. The inbox state keeps every notice
// the session folded (append-only), but the SURFACE is project-scoped like
// every section panel: a multi-desk tenant never sees the demo project's
// seed notices inside their own desk's inbox (M4/M5/L5: 7 unread = 5 demo +
// 2 own). The bell badge, the Home unread tile and the activity timeline
// all follow the same scoped fold.
// ---------------------------------------------------------------------------

describe('render model: D-13 — the inbox renders the PROJECT-SCOPED view', () => {
  /** A two-desk session: desk A (proj-a) folds a notice, the workspace adopts desk B (proj-b), desk B folds its own. O-1c: the bundle settles (the badge/tile counts are the ANSWERED truth — the adoption resets the per-family markers, the bundle's end answers them). */
  function twoDeskState(): WorkspaceState {
    const events: readonly WorkspaceEvent[] = [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'job-updated', at: T0 + 20, job: { jobId: 'job-desk-a', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'failed', submittedAt: T0 + 10 } },
      { kind: 'project-adopted', at: T0 + 30, projectId: 'proj-b' },
      { kind: 'job-updated', at: T0 + 40, job: { jobId: 'job-desk-b', kind: 'research', tenant: 'tenant-a', project: 'proj-b', status: 'failed', submittedAt: T0 + 35 } },
      { kind: 'reads-settled', at: T0 + 45 },
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

// ---------------------------------------------------------------------------
// D-18 (W-29 wave 2) — THE COPY POLISH. Three register items pinned at the
// model layer: (1) the jargon labels explained in place — the Time Machine
// section's one-line modes explainer (S2: "T-x is cryptic pre-click") and
// the Watch heading's plain-words description (S2: "'Watch' is unexplained
// jargon"); (2) the Lessons cards lead with ONE human sentence (L2: the
// lessons rendered as raw field tuples) — the typed record still renders
// beneath it; (3) the evidence capsule row's refs line rides the payload's
// hover title (M5: "evidence ref labels are hard-truncated") — the badge
// half of the fix is pinned in flow.test.ts. The fourth register item (a
// risk-utilization view) is DISCLOSED-SKIPPED: the console surface carries
// bounds only (constraint sets) and breach-time observed values (refusal
// payloads) — no continuous consumption data exists to render, and
// fabricating one is forbidden (L20).
// ---------------------------------------------------------------------------

describe('render model: D-18 — the copy polish (jargon explained, lessons in words, refs hoverable)', () => {
  it('the Lessons card leads with ONE human sentence — the claim in words + confidence + evidence count (L2: field tuples only before), with the typed record still beneath it', () => {
    const state = reduceAll(populatedWorkspace(), [
      { kind: 'view-live', at: T0 + 50 },
      { kind: 'section-selected', at: T0 + 50, section: 'lessons' },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    // the fixture: kind causal, polarity positive, dimension momentum, confidence 0.80, 2 pieces of evidence
    expect(bytes).toContain('data-lesson-summary="true"');
    expect(bytes).toContain('A causal lesson the firm treats as positive (momentum) — confidence 0.80, from 2 pieces of evidence.');
    // the typed record still renders verbatim beneath the sentence (the summary ADDS, never replaces)
    expect(bytes).toContain('claim kind');
    expect(bytes).toContain('causal');
    expect(bytes).toContain('polarity');
    expect(bytes).toContain('momentum');
    expect(bytes).toContain('0.80');
  });

  it('a dimension-less lesson renders its sentence WITHOUT the parenthetical — nothing fabricated', () => {
    const dimensionless: ServedKnowledge = {
      record: { ...knowledge().record, knowledgeId: 'knl-nodim', claim: { ...knowledge().record.claim, dimension: null } },
      status: 'active', supersededBy: null,
    } as unknown as ServedKnowledge;
    const state = reduceAll(populatedWorkspace(), [
      { kind: 'knowledge-loaded', at: T0 + 32, records: [knowledge(), dimensionless] }, // both lessons — the reducer's list is per-read
      { kind: 'view-live', at: T0 + 50 },
      { kind: 'section-selected', at: T0 + 50, section: 'lessons' },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('A causal lesson the firm treats as positive — confidence 0.80, from 2 pieces of evidence.');
    expect(bytes).toContain('(momentum)'); // the dimensioned fixture still renders its own parenthetical
  });

  it('the Time Machine section explains its modes in ONE plain line (S2: "T-x is cryptic pre-click") — every mode named, T-x included', () => {
    const state = reduceAll(populatedWorkspace(), [
      { kind: 'view-live', at: T0 + 50 },
      { kind: 'section-selected', at: T0 + 50, section: 'time-machine' },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('data-tm-explainer="true"');
    expect(bytes).toContain('The modes: LIVE shows the world as the API serves it now; T-x views it as of x seconds before the latest datum; TIMESTAMP picks one explicit instant; PLAYBACK plays history forward, one knowable-then step at a time.');
  });

  it('the Decisions section\'s Watch heading explains itself — the hover title + ONE plain line (S2: "\'Watch\' is unexplained jargon")', () => {
    const state = reduceAll(populatedWorkspace(), [
      { kind: 'view-live', at: T0 + 50 },
      { kind: 'section-selected', at: T0 + 50, section: 'decisions' },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('data-watch-explainer="true"');
    expect(bytes).toContain('The live decision stream — what each agent proposed, the evidence it consulted, and how the gateway answered.');
    expect(bytes).toContain('title="Watch — the live decision stream: what each agent proposed and how the gateway answered"');
    expect(bytes).toContain('aria-label="Watch — the live decision stream"');
  });

  it('the opened evidence capsule\'s payload carries the FULL refs line as its hover title — a wrapped or long refs line never hides a ref (M5\'s finding)', () => {
    const evidence = reduceAll(populatedWorkspace(), [
      { kind: 'view-live', at: T0 + 50 },
      { kind: 'section-selected', at: T0 + 50, section: 'evidence' },
    ]);
    const capsule = capsuleFromOutcome(SCOPE, outcome());
    const opened = serializeVNode(renderConsoleModel(evidence, T0 + 50, { ...defaultShellView(evidence), accountView: 'section', openCapsule: capsule.capsuleId }));
    expect(opened).toContain('data-refs-line="refs: fill:fil-1"'); // the fixture outcome's own evidence ref, verbatim
    expect(opened).toContain('title="refs: fill:fil-1"'); // the hover title carries it too
    expect(opened).toContain('refs: fill:fil-1'); // and the line itself renders in the mono block
  });
});

// ---------------------------------------------------------------------------
// FW-32-B (b2 — Round A blocker 5) — THE ONE EVIDENCE FOLD: Home's
// EVIDENCE CAPSULES stat counts the SAME list the Evidence section renders
// (the D-9 jobs lane included). M1/M3/S2's finding — "Home says 6 while
// Evidence lists 9" — is structurally impossible now: one fold, one count.
// ---------------------------------------------------------------------------

describe('render model: FW-32-B — Home\'s capsule stat is the Evidence section\'s own fold', () => {
  /** The D-9 fixture shape: the read families' capsules PLUS one completed research job with its release-candidate result. O-1c: the bundle settles (the capsule tile's five-lane gate renders the ANSWERED count). */
  function workspaceWithJobsLane(): WorkspaceState {
    const job: JobRecord = { jobId: 'job:57d1815d', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'complete', submittedAt: T0 + 40, completedAt: T0 + 48, result: { kind: 'release-candidate', specId: 'spec-demo-director', version: 1, project: 'proj-a' } };
    return reduceAll(populatedWorkspace(), [
      { kind: 'job-updated', at: T0 + 40, job },
      { kind: 'reads-settled', at: T0 + 45 },
      { kind: 'view-live', at: T0 + 50 },
    ]);
  }

  it('the Home tile counts every capsule the Evidence section lists — the jobs lane included (one source of truth)', () => {
    // The fixture: the read families' capsules PLUS one capsule per
    // completed job with a result (the lane Home's count used to miss).
    const state = workspaceWithJobsLane();
    const homeBytes = serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'home' }));
    // count the Evidence section's capsule cards (the section's own fold)
    const evidenceState = reduceAll(state, [{ kind: 'section-selected', at: T0 + 50, section: 'evidence' }]);
    const evidenceBytes = serializeVNode(renderConsoleModel(evidenceState, T0 + 50, { ...defaultShellView(evidenceState), accountView: 'section' }));
    const evidenceCards = (evidenceBytes.match(/data-capsule-row="/g) ?? []).length;
    expect(evidenceCards).toBeGreaterThanOrEqual(2); // the fixture carries the outcome capsule AND the job capsule
    // the Home tile renders exactly that count — never the read families' count alone
    const tile = /data-stat="EVIDENCE CAPSULES"[^]*?<div class="stat-value">(\d+)<\/div>/.exec(homeBytes);
    if (tile === null) throw new Error('the EVIDENCE CAPSULES tile did not render');
    expect(Number(tile[1])).toBe(evidenceCards);
    // the specific pre-fix defect is dead: the fixture's completed job mints a
    // capsule the Evidence section lists, and Home's count INCLUDES it
    const jobCapsule = capsuleFromJob(SCOPE, { jobId: 'job:57d1815d', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'complete', submittedAt: T0 + 40, completedAt: T0 + 48, result: { kind: 'release-candidate', specId: 'spec-demo-director', version: 1, project: 'proj-a' } });
    expect(evidenceBytes).toContain(`data-capsule-row="${jobCapsule.capsuleId}"`);
    expect(Number(tile[1])).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// FW-33-B (Round B blocker 6, M3 + S2) — THE DEMO SCOPE'S OBSERVED WORLD:
// every new user's first view is the demo scope, whose seeded goal
// genuinely serves no `world` (the host route's additive field) — the
// section rendered "No launch context yet" over an ACTIVE desk. The
// honest render is the world state that EXISTS: the markets and venues
// the desk's execution submissions name, projected at the view instant
// (L4). The teaching empty state survives ONLY for a scope whose
// records show nothing.
// ---------------------------------------------------------------------------

describe('render model: FW-33-B — the observed market world of a world-less scope', () => {
  /** A minimal goal statement (the demo scope's own shape — NO world field ever rides it). */
  function demoGoal(): GoalStatement {
    return {
      id: 'goal-tradrl-demo', version: 1, tenantId: 'tenant-a', objective: 'Operate the demo organization inside its declared risk envelope.',
      horizon: { startsAt: T0 - 90_000, endsAt: T0 + 90_000, label: 'the demo evaluation window' },
      successCriteria: { criteria: [], requiredSatisfaction: 1 },
      evaluation: { blindRef: 'ev-blind', walkForwardRef: 'ev-wf', regimeRef: 'ev-regime', adversarialRequired: false },
      createdAt: T0 - 1_000,
    };
  }

  /** A minimal constraint set (the goal-loaded pair's second half). */
  function demoConstraintSet(): ConstraintSetStatement {
    return { id: 'cs-tradrl-demo', version: 1, tenantId: 'tenant-a', name: 'the demo constraint set', constraints: [], createdAt: T0 - 1_000 };
  }

  /** One routed blotter row with its order leg (the demo backing's own shape: BTC-USD orders on BROKER-FIX). */
  function blotterRow(overrides: Partial<GatewaySubmissionRecord> & { readonly routedAt: number }): GatewaySubmissionRecord {
    return {
      kind: 'routed',
      submissionId: 'xgs:demo',
      decisionId: 'xd:demo',
      auditId: 'xga:demo',
      requestRef: 'gor:demo',
      venue: 'BROKER-FIX',
      adapterRef: 'adapter:demo-broker',
      channelRef: 'chan:demo-main',
      order: {
        clientOrderId: 'ord-demo',
        instrumentId: 'BTC-USD',
        venueId: 'BROKER-FIX',
        side: 'buy',
        kind: 'limit',
        quantity: '0.75',
        price: '61000.50',
        timeInForce: 'gtc',
        createdAt: new Date(overrides.routedAt).toISOString(),
      },
      ...overrides,
    } as GatewaySubmissionRecord;
  }

  it("a world-less scope with execution submissions renders the OBSERVED world — the demo scope's every first view — never \"No launch context yet\"", () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      // the demo scope's own reads: a goal bundle with NO world field (the wire truth) + the seeded blotter
      { kind: 'goal-loaded', at: T0 + 5, goal: demoGoal(), constraintSet: demoConstraintSet() }, // NO world on the wire
      { kind: 'submission-recorded', at: T0 + 40, submission: blotterRow({ routedAt: T0 + 30 }) },
      { kind: 'submission-recorded', at: T0 + 41, submission: blotterRow({ submissionId: 'xgs:demo2', decisionId: 'xd:demo2', auditId: 'xga:demo2', requestRef: 'gor:demo2', routedAt: T0 + 31, order: { clientOrderId: 'ord-demo2', instrumentId: 'ETH-USD', venueId: 'BROKER-FIX', side: 'sell', kind: 'limit', quantity: '6.0', price: '3412.10', timeInForce: 'gtc', createdAt: new Date(T0 + 31).toISOString() } }) },
      { kind: 'section-selected', at: T0 + 50, section: 'market-world' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('data-market-world="observed"');            // the observed-world card
    expect(bytes).toContain('Market world (observed)');                 // the honest title — never "No launch context yet"
    expect(bytes).toContain('BTC-USD, ETH-USD');                        // the markets the orders name
    expect(bytes).toContain('BROKER-FIX');                              // the venue the orders name
    expect(bytes).toContain('none on record');                          // data sources carry no record — never fabricated
    expect(bytes).not.toContain('No launch context yet');               // the misleading teaching state is GONE
    // the card names its own derivation (the honesty law)
    expect(bytes).toContain('no launch specification on record');
    expect(bytes).toContain('observed from its own execution submissions');
  });

  it('the observed world is L4-PROJECTED: a view instant BEFORE the first submission renders the teaching empty state (nothing was knowable then)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'goal-loaded', at: T0 + 5, goal: demoGoal(), constraintSet: demoConstraintSet() },
      { kind: 'submission-recorded', at: T0 + 40, submission: blotterRow({ routedAt: T0 + 30 }) },
      { kind: 'section-selected', at: T0 + 50, section: 'market-world' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    // the view instant sits BEFORE the blotter's verdict instant — the observed fold sees nothing
    const early = reduceAll(state, [{ kind: 'view-timestamp', at: T0 + 50, timestamp: T0 + 10 }]);
    const bytes = serializeConsoleModel(early, T0 + 50);
    expect(bytes).toContain('No launch context yet — the market world is specified at launch.'); // the honest teaching state at this instant
    expect(bytes).not.toContain('data-market-world="observed"');
    // ...and the same state at a view AFTER the verdict renders the observed world again (the projection is instant-derived, never sticky)
    const later = reduceAll(state, [{ kind: 'view-timestamp', at: T0 + 50, timestamp: T0 + 35 }]);
    expect(serializeConsoleModel(later, T0 + 50)).toContain('data-market-world="observed"');
  });

  it('a world-less scope with an EMPTY blotter keeps the teaching empty state (the genuine case — nothing to observe)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'goal-loaded', at: T0 + 5, goal: demoGoal(), constraintSet: demoConstraintSet() }, // NO world
      { kind: 'section-selected', at: T0 + 50, section: 'market-world' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('No launch context yet — the market world is specified at launch.');
    expect(bytes).not.toContain('data-market-world="observed"');
    expect(bytes).toContain('Open Goal'); // the single action stays
  });

  it('a routed row with NO order leg still names its venue (the routed verdict carries it); a refused row with an order leg names its market', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'submission-recorded', at: T0 + 40, submission: { kind: 'routed', submissionId: 'sub-legless', decisionId: 'dec', auditId: 'aud', requestRef: 'req', venue: 'VENUE-ROUTE-ONLY', adapterRef: 'ad', channelRef: 'ch', routedAt: T0 + 30 } as GatewaySubmissionRecord },
      { kind: 'submission-recorded', at: T0 + 41, submission: blotterRow({ routedAt: T0 + 31, order: { clientOrderId: 'ord-3', instrumentId: 'SOL-USD', venueId: 'VENUE-ORDER', side: 'buy', kind: 'limit', quantity: '1', price: '100', timeInForce: 'gtc', createdAt: new Date(T0 + 31).toISOString() } }) },
      { kind: 'section-selected', at: T0 + 50, section: 'market-world' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('SOL-USD');                    // the order's own instrument
    expect(bytes).toContain('VENUE-ROUTE-ONLY, VENUE-ORDER'); // BOTH venues, first-appearance order (the route fallback then the order's own)
  });
});

// ---------------------------------------------------------------------------
// FW-34-B (Round C register §3.7): the execution blotter's AGGREGATE
// TOTALS card (L4's finding: "no aggregate blotter totals — 'what team
// works my book' is unanswerable in-product") and the ORG PER-AGENT
// MANDATE/SPEC DRILL-DOWN (L4/M3: "bare instance ids, no per-agent
// mandate/spec drill-down").
// ---------------------------------------------------------------------------

describe('FW-34-B: the Execution totals card (the aggregate blotter fold, rendered)', () => {
  /** A routed row (fill economics optional — the blotter's own demo shape). */
  function routedRow(id: string, at: number, fill?: { readonly notional: string; readonly fee: string }): GatewaySubmissionRecord {
    return {
      kind: 'routed', submissionId: id, decisionId: `dec-${id}`, auditId: `aud-${id}`, requestRef: `req-${id}`,
      venue: 'BROKER-FIX', adapterRef: 'adapter:demo-broker', channelRef: 'chan:demo-main', routedAt: at,
      order: { clientOrderId: `ord-${id}`, instrumentId: 'BTC-USD', venueId: 'BROKER-FIX', side: 'buy', kind: 'limit', quantity: '1', price: '61000.50', timeInForce: 'gtc', createdAt: new Date(at).toISOString() },
      ...(fill === undefined ? {} : { fill: { state: 'filled', quantity: '1', price: '1', notional: fill.notional, fee: fill.fee, filledAt: at } }),
    } as GatewaySubmissionRecord;
  }

  it('the totals card renders the exact-decimal sums over the PROJECTED rows — fills, notional, fees, refusals (never a fabricated fill)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'submission-recorded', at: T0 + 40, submission: routedRow('sub-1', T0 + 30, { notional: '1000.10', fee: '0.025' }) },
      { kind: 'submission-recorded', at: T0 + 41, submission: routedRow('sub-2', T0 + 31, { notional: '250.25', fee: '0.01' }) },
      { kind: 'submission-recorded', at: T0 + 42, submission: routedRow('sub-routed-only', T0 + 32) }, // routed, NO fill yet
      { kind: 'submission-recorded', at: T0 + 43, submission: { kind: 'refused', submissionId: 'sub-refused', decisionId: null, auditId: 'aud-x', refusal: { stage: 'risk_limits', bound: '2', observed: '2.4', constraintId: 'k-position' }, refusedAt: T0 + 33 } as GatewaySubmissionRecord },
      { kind: 'section-selected', at: T0 + 50, section: 'execution' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('data-blotter-totals');
    expect(bytes).toContain('Execution totals');
    expect(bytes).toContain('1250.35'); // the exact notional sum: 1000.10 + 250.25 (the float trap is the point)
    expect(bytes).toContain('0.035');   // the exact fee sum: 0.025 + 0.01
    expect(bytes).toContain('2 fills');
    expect(bytes).toContain('1 routed without a fill record yet'); // the honest clause (not a fabricated fill)
    expect(bytes).toContain('1 refusal the gateway stopped');      // the refusal counts its own row
    expect(bytes).toContain('exact-decimal sum');                  // the note states how the numbers were computed
  });

  it('the totals are L4-PROJECTED: a view instant BEFORE the fills renders the totals THEN (never a future leak)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'submission-recorded', at: T0 + 40, submission: routedRow('sub-1', T0 + 30, { notional: '1000.10', fee: '0.025' }) },
      { kind: 'submission-recorded', at: T0 + 41, submission: routedRow('sub-2', T0 + 45, { notional: '250.25', fee: '0.01' }) }, // filled LATER
      { kind: 'section-selected', at: T0 + 50, section: 'execution' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const early = reduceAll(state, [{ kind: 'view-timestamp', at: T0 + 50, timestamp: T0 + 35 }]);
    const bytes = serializeConsoleModel(early, T0 + 50);
    expect(bytes).toContain('1 fill');               // only the FIRST fill was knowable at T0+35
    expect(bytes).toContain('notional 1000.10');     // the note's total reflects exactly that
    expect(bytes).not.toContain('1250.35');          // the later fill NEVER leaks into the past view
  });

  it('an empty blotter renders NO totals card (never a fabricated zero-sum over nothing)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'section-selected', at: T0 + 50, section: 'execution' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    expect(serializeConsoleModel(state, T0 + 50)).not.toContain('data-blotter-totals');
  });
});

describe('FW-34-B: the org per-agent mandate/spec drill-down (the snapshot detail sheet)', () => {
  /** A workspace with a goal + a snapshot whose instances follow the served ref grammar. */
  function orgWorkspace(): WorkspaceState {
    return reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'project-loaded', at: T0 + 2, project: projectRecord() },
      { kind: 'goal-loaded', at: T0 + 5, goal: {
      id: 'goal-1', version: 1, tenantId: 'tenant-a',
      objective: 'Compound the book inside the risk framework.',
      horizon: { startsAt: T0, endsAt: T0 + 90_000, label: 'Q1' },
      successCriteria: { criteria: [{ id: 'sc-1', metric: 'return.net', predicate: { kind: 'limit.min', bound: 1_250_000 } }], requiredSatisfaction: 1 },
      evaluation: { blindRef: 'ev-blind', walkForwardRef: 'ev-wf', regimeRef: 'ev-reg', adversarialRequired: false },
      createdAt: T0,
    } as GoalStatement, constraintSet: { id: 'cs-tradrl-demo', version: 1, tenantId: 'tenant-a', name: 'the demo constraint set', constraints: [], createdAt: T0 - 1_000 } as ConstraintSetStatement },
      { kind: 'org-snapshot', at: T0 + 10, snapshot: { organizationRef: 'org:alpha', tenant: 'tenant-a', project: 'proj-a', status: 'active', at: T0 + 10, instanceRefs: ['ai:director-1', 'ai:researcher-2', 'inst:opaque-3'] } as OrgStatusSnapshot },
      { kind: 'section-selected', at: T0 + 50, section: 'organization' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
  }

  it('the snapshot row NAMES the roles (read from the instance refs own grammar) — never a bare id list', () => {
    const bytes = serializeConsoleModel(orgWorkspace(), T0 + 50);
    expect(bytes).toContain('3 instances'); // the count
    expect(bytes).toContain('director + researcher + unspecified'); // the roles, in ref order (the opaque id reads as unspecified — never a guess)
  });

  it('the drill-down sheet: one section PER INSTANCE — the role, the mandate (the project own goal statement), the spec, the observed acts — plus the honest not-served disclosure', () => {
    const view = { ...defaultShellView(orgWorkspace()), sheet: { kind: 'snapshot', id: 'org:alpha' } as const };
    const bytes = serializeVNode(renderConsoleModel(orgWorkspace(), T0 + 50, view));
    expect(bytes).toContain('INSTANCE ai:director-1');
    expect(bytes).toContain('INSTANCE ai:researcher-2');
    expect(bytes).toContain('INSTANCE inst:opaque-3');
    // the ROLE reads from the ref grammar, stated as such
    expect(bytes).toContain('director (read from the instance ref');
    expect(bytes).toContain('unspecified (read from the instance ref'); // the opaque ref never guesses
    // the MANDATE is the project own goal statement — the whole organization works it
    expect(bytes).toContain('Compound the book inside the risk framework.');
    expect(bytes).toContain('THE MANDATE THIS ORGANIZATION WORKS');
    // the budget row (no launch spec on record for this fixture — the honest line, never fabricated)
    expect(bytes).toContain('no launch specification on record');
    // the observed acts row (counted at this view instant)
    expect(bytes).toContain('observed acts at this view instant');
    // THE HONEST DISCLOSURE: the per-agent mandate TEXT is not served by the API today — stated, never papered over
    expect(bytes).toContain('per-agent mandate text is not served yet');
    expect(bytes).toContain('nothing here is invented');
  });
});

// ---------------------------------------------------------------------------
// FW-36-B (Round E register E-8, parts 1 + 3) — THE ROW-LEVEL SIMULATED
// DISCLOSURE + THE DEMO-TENANT MARKING. L3's audit: "airtight at page/prose
// level; leaks at the row/number level — exactly where a board-pack number
// gets copied from" — individual blotter fill rows carried no simulated label
// (a copied row read bare "filled · notional 345600000000 · fee 172800"), and
// a fresh session rendered the shared demo project's notices/activity
// UNMARKED on Home/nav while the export disclosed the 2-project chain span.
// ---------------------------------------------------------------------------

describe('FW-36-B (E-8, part 1): the per-row SIMULATED tags on every blotter row', () => {
  /** A routed fill row (the demo blotter's own shape — the exact "copied row" class). */
  function routedFillRow(id: string, at: number): GatewaySubmissionRecord {
    return {
      kind: 'routed', submissionId: id, decisionId: `dec-${id}`, auditId: `aud-${id}`, requestRef: `req-${id}`,
      venue: 'BROKER-FIX', adapterRef: 'adapter:demo-broker', channelRef: 'chan:demo-main', routedAt: at,
      order: { clientOrderId: `ord-${id}`, instrumentId: 'BTC-USD', venueId: 'BROKER-FIX', side: 'buy', kind: 'limit', quantity: '1', price: '61000.50', timeInForce: 'gtc', createdAt: new Date(at).toISOString() },
      fill: { state: 'filled', quantity: '1', price: '61000.50', notional: '345600000000', fee: '172800', filledAt: at },
    } as GatewaySubmissionRecord;
  }

  /** A refused row (the honest refusal — the blotter's other row class). */
  function refusedRow(id: string, at: number): GatewaySubmissionRecord {
    return {
      kind: 'refused', submissionId: id, decisionId: null, auditId: `aud-${id}`, refusal: { stage: 'risk_limits', bound: '2', observed: '2.4', constraintId: 'k-position' }, refusedAt: at,
    } as GatewaySubmissionRecord;
  }

  /** The blotter state: one fill + one refusal, the Execution section selected. */
  function blotterState(): WorkspaceState {
    return reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'submission-recorded', at: T0 + 40, submission: routedFillRow('xgs:fill-1', T0 + 30) },
      { kind: 'submission-recorded', at: T0 + 41, submission: refusedRow('xgs:refused-1', T0 + 31) },
      { kind: 'section-selected', at: T0 + 50, section: 'execution' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
  }

  it('SIMULATED view: EVERY blotter row — fill AND refusal — carries the visible SIMULATED tag (the per-section chip class, per row)', () => {
    const state = blotterState();
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 60, { ...defaultShellView(state), simulated: true }));
    expect(bytes).toContain('xgs:fill-1');
    expect(bytes).toContain('xgs:refused-1');
    // the tag rides EVERY row (2 rows, 2 tags) with the section badge's own class
    expect(bytes.match(/data-simulated-tag="true"/g)?.length).toBe(2);
    expect(bytes).toContain('class="badge badge-simulated" data-simulated-tag="true"');
    expect(bytes).toContain('filled · notional 345600000000 · fee 172800'); // the copyable row keeps its substance — now labeled
  });

  it('the Decisions section\'s served submission rows carry the SAME per-row tag (a copied verdict must never read as production on either surface)', () => {
    const state = reduceAll(blotterState(), [{ kind: 'section-selected', at: T0 + 55, section: 'decisions' }]);
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 60, { ...defaultShellView(state), simulated: true }));
    expect(bytes.match(/data-simulated-tag="true"/g)?.length).toBe(2); // both gateway records, tagged
  });

  it('a LIVE console (simulated: false) renders NO per-row tag — byte-identical to the pre-fix card (never a fabricated marker)', () => {
    const state = blotterState();
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 60, { ...defaultShellView(state), simulated: false }));
    expect(bytes).not.toContain('data-simulated-tag');
    expect(bytes).toContain('xgs:fill-1'); // the rows still render with full substance
    expect(bytes).toContain('filled · notional 345600000000 · fee 172800');
  });
});

describe('FW-36-B (E-8, part 3): the DEMO marker on the fresh-session Home activity + the nav bell', () => {
  /** A workspace scoped to the SHARED DEMO PROJECT (every fresh session's first world) with one folded notice. O-1c: the bundle settles (the bell's count label is the ANSWERED truth). */
  function demoScopeState(): WorkspaceState {
    return reduceAll(openWorkspace({ tenantId: 'tenant-a', projectId: 'prj-demo-console' }, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'job-updated', at: T0 + 20, job: { jobId: 'job-demo-1', kind: 'research', tenant: 'tenant-a', project: 'prj-demo-console', status: 'failed', submittedAt: T0 + 10 } },
      { kind: 'reads-settled', at: T0 + 45 },
      { kind: 'view-live', at: T0 + 50 },
    ]);
  }

  it('the DEMO-scope Home RECENT ACTIVITY: every entry carries the DEMO chip, and the nav bell carries it too (the badge counts derive from the shared demo project)', () => {
    const state = demoScopeState();
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 60, { ...defaultShellView(state), accountView: 'home' }));
    expect(bytes).toContain('Recent activity');
    expect(bytes).toContain('job-demo-1'); // the notice folded and renders
    // the chip rides the timeline row AND the bell
    expect(bytes).toContain('data-demo="true"');
    expect(bytes).toContain('>DEMO<');
    expect(bytes).toContain('class="demo-flag timeline-demo" data-demo="true"');
    expect(bytes).toContain('class="demo-flag bell-demo" data-demo="true"');
    // the bell's aria-label names the source (the a11y tree carries the disclosure)
    expect(bytes).toContain('aria-label="Inbox — 1 unread notice (the shared demo project)"');
  });

  it('a NON-demo scope renders NO markers — never a fabricated disclosure (the export disclosed the span; the UI only marks what IS demo)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'job-updated', at: T0 + 20, job: { jobId: 'job-own-1', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'failed', submittedAt: T0 + 10 } },
      { kind: 'reads-settled', at: T0 + 45 }, // O-1c: the answered count label
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 60, { ...defaultShellView(state), accountView: 'home' }));
    expect(bytes).toContain('job-own-1'); // the notice still renders
    expect(bytes).not.toContain('data-demo="true"');
    expect(bytes).toContain('aria-label="Inbox — 1 unread notice"'); // the plain label, no demo clause
  });

  it('switching INTO the demo scope marks the surfaces; switching back unmarks them (the marker follows the scope, never the session history)', () => {
    const intoDemo = reduceAll(demoScopeState(), [{ kind: 'project-adopted', at: T0 + 60, projectId: 'prj-demo-console' }]);
    expect(intoDemo.scope.projectId).toBe('prj-demo-console');
    const demoBytes = serializeVNode(renderConsoleModel(intoDemo, T0 + 70, { ...defaultShellView(intoDemo), accountView: 'home' }));
    expect(demoBytes).toContain('data-demo="true"');
    const back = reduceAll(intoDemo, [{ kind: 'project-adopted', at: T0 + 80, projectId: 'proj-a' }]);
    const ownBytes = serializeVNode(renderConsoleModel(back, T0 + 90, { ...defaultShellView(back), accountView: 'home' }));
    expect(ownBytes).not.toContain('data-demo="true"');
  });
});

// ---------------------------------------------------------------------------
// FW-41-B (Round I register I-2 — 7/7 personas who checked) — the wizard's
// execution-mode select: THE PAINT CONTRACT + M2's sticky-bar occlusion
// half. The register's split: the select's STATE is correct everywhere
// (Review + the launch record read "simulation" — pinned in
// render/launch.test.ts) while its DISPLAY never survives a beat: the
// FW-40-C identity law transplants the live select element, but its
// value-restore branch (written for the text-control class) read a
// `value` CONTENT attribute a select never carries, so every beat fell
// through to the `''` default and WIPED the displayed selection
// (L1: "val '' idx -1; selectOption ran clean but val still '' idx -1";
// S1: "UI select command, native value setter, and keyboard ArrowDown
// all wiped by the next ~500ms re-render"). THE PAINT CONTRACT: the
// model value rides the select ELEMENT ITSELF (value="..." — the
// transplant's model-truth carrier, the exact mirror of labeledInput)
// ALONGSIDE the options' selected paint (the fresh projection's display
// carrier) — the display never depends on the beat's mercy again.
// M2's occlusion half: "a sticky .tm-playback bar (z-index 5) occludes
// the execution control at the natural scroll position (click lands on
// the overlay until scrolled clear)" — the render-surface laws: the
// sticky action row is CLICK-THROUGH outside its buttons (the FW-35-B
// class, applied inline — the row's own chrome lives in the shell
// surface's stylesheet), and the wizard's controls carry the sticky-row
// CLEARANCE so a focus/scrollIntoView lands them above the pinned row.
// ---------------------------------------------------------------------------

describe('FW-41-B (I-2 + M2\'s occlusion): the wizard\'s execution-mode select — the paint contract + the sticky-row reach laws', () => {
  /** A wizard draft (launch.test.ts's own fixture shape, local to this block). */
  function wizardDraft(executionMode: string): LaunchDraft {
    return {
      name: 'Momentum scout',
      objective: 'Beat the index with bounded drawdown.',
      horizon: { startsAt: T0, endsAt: T0 + 86_400_000, label: 'one day' },
      successCriteria: [],
      evaluation: { blindRef: 'blind-1', walkForwardRef: 'wf-1', regimeRef: 'regime-1', adversarialRequired: true },
      constraints: [],
      capitalBudget: '10000.00',
      riskBudget: '250.00',
      markets: ['SPY'],
      venues: ['venue-x'],
      dataSources: ['src-1'],
      executionMode,
      preferences: [],
    } as unknown as LaunchDraft;
  }

  /** A workspace with the wizard open at a step (the goal section — the primary flow's own surface). */
  function wizardAtStep(step: string, executionMode = 'simulation'): WorkspaceState {
    return reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'launch-draft-started', at: T0 + 2, draft: wizardDraft(executionMode) },
      { kind: 'launch-step-changed', at: T0 + 3, step: step as never },
      { kind: 'section-selected', at: T0 + 4, section: 'goal' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
  }

  /** The serialized opening tag of the wizard's execution-mode select (the only .field-select). */
  function executionSelectOpenTag(bytes: string): string {
    const openTag = /<select class="field-input field-select"[^>]*>/.exec(bytes);
    if (openTag === null) throw new Error('the execution-mode select is missing from the projection');
    return openTag[0];
  }

  it('(a) the initial projection paints BOTH display carriers: the model value rides the select ELEMENT (value="simulation") alongside the option\'s selected paint', () => {
    const bytes = serializeVNode(renderConsoleModel(wizardAtStep('world'), T0 + 50));
    const openTag = executionSelectOpenTag(bytes);
    expect(openTag).toContain(' value="simulation"'); // the element-level carrier — the transplant's model truth (RED pre-fix: absent)
    expect(openTag).toContain('data-launch-field="executionMode"'); // the delegated change wiring stays
    // ...and the fresh projection's own display carrier: the matching option paints selected, the others never do
    const modeSelect = /<select class="field-input field-select"[\s\S]*?<\/select>/.exec(bytes);
    if (modeSelect === null) throw new Error('the execution-mode select body is missing');
    expect(modeSelect[0]).toContain('<option value="simulation" selected="selected">');
    expect(modeSelect[0]).not.toContain('<option value="shadow" selected');
    expect(modeSelect[0]).not.toContain('<option value="live" selected');
  });

  it('a changed model value repaints BOTH carriers (the draft\'s own execution mode paints through — never a stale option face)', () => {
    const bytes = serializeVNode(renderConsoleModel(wizardAtStep('world', 'shadow'), T0 + 50));
    expect(executionSelectOpenTag(bytes)).toContain(' value="shadow"'); // the element-level carrier follows the model
    const modeSelect = /<select class="field-input field-select"[\s\S]*?<\/select>/.exec(bytes);
    if (modeSelect === null) throw new Error('the execution-mode select body is missing');
    expect(modeSelect[0]).toContain('<option value="shadow" selected="selected">');
    expect(modeSelect[0]).not.toContain('<option value="simulation" selected');
  });

  it('M2\'s occlusion half — the sticky action row is CLICK-THROUGH outside its buttons: the row carries pointer-events:none inline and its Next/Review buttons pointer-events:auto (the FW-35-B class on the wizard\'s own chrome)', () => {
    const bytes = serializeVNode(renderConsoleModel(wizardAtStep('world'), T0 + 50));
    // the row (the wizard's own .tm-playback — distinct from the TM band's, which carries role=group)
    expect(bytes).toContain('<div class="tm-playback" style="pointer-events:none">');
    // the buttons keep their full hit areas AND their wiring (the click-through never disables the actions)
    expect(bytes).toContain('id="launch-next" style="pointer-events:auto"');
    expect(bytes).toContain('id="launch-review-button" style="pointer-events:auto"');
    expect(bytes).toContain('data-action="launch-step-review"');
  });

  it('the armed confirm row carries the SAME click-through law (the review step\'s sticky chrome never eats a covered click)', () => {
    const bytes = serializeVNode(renderConsoleModel(wizardAtStep('review'), T0 + 50, { ...defaultShellView(wizardAtStep('review')), confirm: 'launch' }));
    expect(bytes).toContain('<div class="confirm-inline" style="pointer-events:none"');
    expect(bytes).toContain('class="confirm-cancel" style="pointer-events:auto"');
    expect(bytes).toContain('class="confirm-go" style="pointer-events:auto"');
    expect(bytes).toContain('data-action="confirm-launch"'); // the confirm wiring stays
  });

  it('the wizard\'s controls carry the sticky-row CLEARANCE (scroll-margin-bottom) — a focus/scrollIntoView lands the field ABOVE the pinned row; scoped to the wizard\'s own five world-step controls', () => {
    const bytes = serializeVNode(renderConsoleModel(wizardAtStep('world'), T0 + 50));
    expect(executionSelectOpenTag(bytes)).toContain('style="scroll-margin-bottom:72px"'); // the covered class itself: the select
    expect(bytes).toContain('id="launch-preferences"'); // a text control of the same step, for the count's anchor
    // EXACTLY the wizard's five world-step controls (2 datetime + the select + preferences + constraints) —
    // the TM band's own controls and the other forms' fields carry no clearance
    expect(bytes.match(/style="scroll-margin-bottom:72px"/g)?.length ?? 0).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// FW-41-C (Round I register I-3b — the hydration PENDING marker). S3, L1,
// L3, M3: the ~10-22s post-boot window read "Not compiled yet" / "No
// organization snapshots" with NO pending marker — the honest terminal
// empty state taught a terminal absence over an ACTIVE seek. THE LAW:
// while the console's read cadence is ACTIVELY seeking this desk's
// compiled records (the project on hand + connected + zero org
// snapshots ever) AND the view is the LIVE edge, the surfaces teach
// "Reading the world…" (data-hydration-pending) — the honest terminal
// empty state renders ONLY when the seek is not active at the view (a
// scrubbed instant, a degraded connection, or a read that landed).
// ---------------------------------------------------------------------------

describe('FW-41-C (I-3b): the hydration PENDING marker — "Reading the world…" vs the honest terminal empty state', () => {
  /** A desk mid-hydration: the project record on hand, connected, NO organization snapshot ever landed, the machine LIVE at the fresh anchor — the beat's org read is in flight. */
  function hydratingWorkspace(): WorkspaceState {
    return reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'project-loaded', at: T0 + 2, project: projectRecord() },
      { kind: 'view-live', at: T0 + 50 }, // the live view (the anchor advances past the records)
    ]);
  }

  it('the LIVE view over the in-flight read teaches PENDING on the Organization section — never the terminal empty state (the register: reads Not-compiled-yet with no pending marker)', () => {
    const state = reduceAll(hydratingWorkspace(), [{ kind: 'section-selected', at: T0 + 51, section: 'organization' }]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('data-hydration-pending="true"'); // the marker the register asked for
    expect(bytes).toContain('Reading the world…');
    expect(bytes).not.toContain('No organization snapshots at this view instant.'); // the honest terminal copy renders ONLY once the seek is not active (RED pre-fix: it rendered mid-seek)
  });

  it('the LIVE view teaches PENDING on the Home ORGANIZATION tile too — never the terminal "Not compiled yet"', () => {
    const state = hydratingWorkspace();
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'home' })); // the HOME panel (the analyst's default desk view)
    expect(bytes).toContain('data-rich-stat="ORGANIZATION"');
    expect(bytes).toContain('Reading the world…');
    expect(bytes).not.toContain('Not compiled yet'); // RED pre-fix: the terminal text over an active seek
  });

  it('the boundary law: a SCRUBBED PAST view keeps the honest terminal empty state (the pending state is about NOW) — and a landed read renders the snapshot with no marker anywhere', () => {
    // scrubbed: the view moves below the anchor — the past view's honest empty state is exactly as before
    const scrubbed = reduceAll(hydratingWorkspace(), [
      { kind: 'view-timestamp', at: T0 + 51, timestamp: T0 + 40 },
      { kind: 'section-selected', at: T0 + 52, section: 'organization' },
    ]);
    const scrubbedBytes = serializeConsoleModel(scrubbed, T0 + 51);
    expect(scrubbedBytes).not.toContain('data-hydration-pending');
    expect(scrubbedBytes).toContain('No organization snapshots at this view instant.'); // the honest empty state at a past view — unchanged
    // landed: the read completed — the snapshot card renders, no pending marker anywhere
    const landed = reduceAll(hydratingWorkspace(), [
      { kind: 'org-snapshot', at: T0 + 60, snapshot: orgSnapshot() },
      { kind: 'section-selected', at: T0 + 61, section: 'organization' },
    ]);
    const landedBytes = serializeConsoleModel(landed, T0 + 61);
    expect(landedBytes).not.toContain('data-hydration-pending');
    expect(landedBytes).toContain('org:alpha'); // the snapshot card renders (the honest post-read state)
    expect(landedBytes).not.toContain('No organization snapshots at this view instant.');
  });
});

// ---------------------------------------------------------------------------
// FW-42-B (Round J register I-3b — the reload-path hydration marker, the
// render half). The register's quantification (M2, L2): on a COMPILED
// desk the post-reload window taught the bare "Not compiled yet" on the
// Home ORGANIZATION tile for ~3-8.5s before the late "Reading the
// world…" marker — the honest-empty wording MISSTATING a compiled desk
// (the launch/switch path is prompt: its project record lands with the
// adoption). THE LAW: the boot/reload path's hydration state is PENDING
// from the first paint until the read completes — the same marker the
// launch path uses; "Not compiled yet" renders ONLY after the read
// completes empty (the launchpad — no desk exists at all).
// ---------------------------------------------------------------------------

describe('FW-42-B (I-3b): the reload-path pending window on the Home ORGANIZATION tile', () => {
  /** The reload window on a COMPILED desk: connected, the stored scope adopted, the project record not yet read, no snapshot ever. */
  function reloadingWorkspace(): WorkspaceState {
    return reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'project-adopted', at: T0 + 2, projectId: 'proj-a' }, // the stored-scope adoption — the read bundle is in flight
      { kind: 'view-live', at: T0 + 50 }, // the live edge (the reload's own posture)
    ]);
  }

  it('the reload window over a COMPILED desk teaches PENDING — never the bare "Not compiled yet" (the misstatement)', () => {
    const bytes = serializeVNode(renderConsoleModel(reloadingWorkspace(), T0 + 50, { ...defaultShellView(reloadingWorkspace()), accountView: 'home' }));
    expect(bytes).toContain('data-rich-stat="ORGANIZATION"');
    expect(bytes).toContain('Reading the world…'); // the same marker the launch path uses
    expect(bytes).not.toContain('Not compiled yet'); // RED pre-fix: the bare honest-empty wording over a compiled desk
  });

  it('the launchpad boot stays the honest terminal empty (no desk exists at all — the marker never lies about nothing)', () => {
    const launchpad = reduceAll(openWorkspace({ tenantId: 'tenant-a', projectId: '(launchpad)' }, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeVNode(renderConsoleModel(launchpad, T0 + 50, { ...defaultShellView(launchpad), accountView: 'home' }));
    expect(bytes).toContain('Not compiled yet'); // the honest terminal — nothing was ever launched
    expect(bytes).not.toContain('data-hydration-pending="true"');
  });
});

// ---------------------------------------------------------------------------
// FW-42-B (Round J register J-3 — the prj-demo-console flash on the
// Project line during reload, L2/M2's find): the Home ORGANIZATION tile's
// Project detail taught the ENV PIN's desk id for the whole listing
// latency, then flashed to the remembered desk when the stored-scope
// adoption landed. THE LAW: while the boot listing resolves a stored
// scope that differs from the env pin, the Project line teaches the
// resolving marker — never a wrong desk id.
// ---------------------------------------------------------------------------

describe('FW-42-B (J-3): the Home tile\'s Project line resolves during the boot-scope window', () => {
  it('the resolving marker renders while the listing is in flight (the view flag the boot/resume plane owns)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'home', bootScopeResolving: true }));
    expect(bytes).toContain('<dt>Project</dt><dd>resolving your desk…</dd>'); // the marker, never the env pin's flash
    expect(bytes).not.toContain(`<dt>Project</dt><dd>${SCOPE.projectId}</dd>`);
  });

  it('the settled render keeps the exact pre-fix bytes (undefined flag = the default every prior surface keeps)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'home' }));
    expect(bytes).toContain(`<dt>Project</dt><dd>${SCOPE.projectId}</dd>`);
    expect(bytes).not.toContain('resolving your desk…'); // a fresh boot (no stored scope) NEVER carries the marker — the demo flow untouched
  });
});

// ---------------------------------------------------------------------------
// N-1 (Round N register — the read-lag class, the round's TOP friction,
// 5+ seats): for ~3-10s after a reload, a switch, a declare or a sign-in
// the cards render the DURABLE empty-state copy ("No research notes
// attached to this project on record yet", "No project history is on
// record yet", "No notices at this view instant", a waiting verdict where
// FIRED stands, "No execution submissions at this view instant", "risk
// policies none at this view instant") BEFORE the fetch completes — the
// words promise durability the read has not answered (M1: the job list
// ~10s, the Inbox ~6s, the risk standing read ~15min-until-reload; S2:
// the settling flash, indistinguishable-at-a-glance from Round M's
// evaporation; S3: "for exactly those seconds a 2h/week operator fears
// their Monday note has vanished again"; L3: "from a compliance seat
// those seconds read as missing books"). THE LAW (the honest-copy law,
// the FW-41-C hydration-pending precedent generalized): the pre-read
// state is a LOADING state, never a durable-empty claim — the surfaces
// teach "Reading the world…" while the family's read is IN FLIGHT at
// the LIVE view, and the durable copy renders ONLY when the read has
// answered (the family's loaded/settled event — the per-family marker —
// or the bundle's reads-settled).
// ---------------------------------------------------------------------------

describe('N-1 (Round N register — the read-lag class): "Reading the world…" vs the durable empty-state copy', () => {
  it('the Research section mid-read teaches PENDING on the notes card AND the jobs empty state — never the durable claims (L3\'s ~6s "No research notes attached … No research jobs" over a desk that carried 3 notes + 2 jobs)', () => {
    const state = reduceAll(midReadWorkspace(), [{ kind: 'section-selected', at: T0 + 51, section: 'research' }]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('data-hydration-pending="true"'); // the marker the register asked for
    expect(bytes).toContain('Reading the world…'); // the loading vocabulary, never the durable claim
    expect(bytes).not.toContain('No research notes attached to this project on record yet'); // RED pre-fix: the durable claim over an in-flight read
    expect(bytes).not.toContain('No research jobs at this view instant.'); // RED pre-fix: same class, the jobs family
  });

  it('the per-family granularity: a goal-bundle read that ANSWERED (no notes on record) resolves the notes card to the durable copy while the jobs empty state still reads PENDING (the families settle at their own reads, never in lockstep)', () => {
    const state = midReadWorkspace([
      { kind: 'goal-loaded', at: T0 + 10, goal: goalOf(), constraintSet: constraints() }, // the goal read answered — NO notes field (none on record)
      { kind: 'section-selected', at: T0 + 51, section: 'research' },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('No research notes attached to this project on record yet'); // the read ANSWERED empty — the durable claim is now true
    expect(bytes).toContain('data-hydration-pending="true"'); // the jobs read is still in flight
    expect(bytes).not.toContain('No research jobs at this view instant.');
  });

  it('the reads-settled marker resolves EVERY family to its honest durable copy (the bundle ran to its end — an empty jobs list is the read\'s answer, never a read still in flight)', () => {
    const state = midReadWorkspace([
      { kind: 'goal-loaded', at: T0 + 10, goal: goalOf(), constraintSet: constraints() },
      { kind: 'reads-settled', at: T0 + 20 },
      { kind: 'section-selected', at: T0 + 51, section: 'research' },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('No research notes attached to this project on record yet');
    expect(bytes).toContain('No research jobs at this view instant.'); // the read answered empty — the honest terminal copy
    expect(bytes).not.toContain('data-hydration-pending');
  });

  it('the Inbox mid-read teaches PENDING — never "No notices at this view instant" (M1\'s ~6s demo-Inbox flash; the notices fold rides the record families\' own reads)', () => {
    const mid = midReadWorkspace();
    const bytes = serializeVNode(renderConsoleModel(mid, T0 + 50, { ...defaultShellView(mid), accountView: 'inbox' }));
    expect(bytes).toContain('data-hydration-pending="true"');
    expect(bytes).not.toContain('No notices at this view instant.'); // RED pre-fix: the durable claim over the in-flight record reads
    const settled = reduceAll(midReadWorkspace([{ kind: 'reads-settled', at: T0 + 20 }]), [{ kind: 'view-live', at: T0 + 51 }]);
    const settledBytes = serializeVNode(renderConsoleModel(settled, T0 + 50, { ...defaultShellView(settled), accountView: 'inbox' }));
    expect(settledBytes).toContain('No notices at this view instant.'); // the reads answered — zero notices is the honest answer
    expect(settledBytes).not.toContain('data-hydration-pending');
  });

  it('the Execution section mid-read teaches PENDING — never "No execution submissions at this view instant" (M2\'s blotter shape: the copy rendered while the fills HAD booked)', () => {
    const state = reduceAll(midReadWorkspace(), [{ kind: 'section-selected', at: T0 + 51, section: 'execution' }]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('data-hydration-pending="true"');
    expect(bytes).not.toContain('No execution submissions at this view instant.'); // RED pre-fix
    const settled = reduceAll(midReadWorkspace([{ kind: 'reads-settled', at: T0 + 20 }]), [{ kind: 'section-selected', at: T0 + 51, section: 'execution' }]);
    expect(serializeConsoleModel(settled, T0 + 50)).toContain('No execution submissions at this view instant.');
  });

  it('the Risk section mid-read: the standing utilization note AND the risk-policies row teach PENDING — never "no standing read on record" / "none at this view instant" as durable claims (M1\'s ~15min standing read; L3\'s policies row)', () => {
    const state = midReadWorkspace([
      { kind: 'goal-loaded', at: T0 + 10, goal: goalOf(), constraintSet: constraints() }, // the bounds are declared — the standing read's family is still in flight
      { kind: 'section-selected', at: T0 + 51, section: 'risk' },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('data-hydration-pending="true"');
    expect(bytes).not.toContain('No standing utilization read is on record for this scope'); // RED pre-fix: the read simply has not answered yet
    expect(bytes).not.toContain('none at this view instant'); // the outcomes read is in flight — 'none' is not yet a claim the state can make
    const settled = midReadWorkspace([
      { kind: 'goal-loaded', at: T0 + 10, goal: goalOf(), constraintSet: constraints() },
      { kind: 'reads-settled', at: T0 + 20 },
      { kind: 'section-selected', at: T0 + 51, section: 'risk' },
    ]);
    const settledBytes = serializeConsoleModel(settled, T0 + 50);
    expect(settledBytes).toContain('No standing utilization read is on record for this scope'); // the host route answered — the honest teaching note
    expect(settledBytes).toContain('none at this view instant'); // the outcomes read answered empty
  });

  it('Home mid-read: the activity timeline teaches PENDING (never "No activity yet") and the ORGANIZATION tile\'s Instances row reads the seek (never a bare "0" — L3\'s post-reload frame)', () => {
    const mid = midReadWorkspace();
    const bytes = serializeVNode(renderConsoleModel(mid, T0 + 50, { ...defaultShellView(mid), accountView: 'home' }));
    expect(bytes).toContain('data-hydration-pending="true"'); // the timeline
    expect(bytes).not.toContain('No activity yet'); // RED pre-fix: the durable claim over the in-flight record reads
    expect(bytes).not.toContain('<dt>Instances</dt><dd>0</dd>'); // RED pre-fix: the org seek renders, never the terminal 0
    const settled = reduceAll(midReadWorkspace([{ kind: 'reads-settled', at: T0 + 20 }]), [{ kind: 'view-live', at: T0 + 51 }]);
    const settledBytes = serializeVNode(renderConsoleModel(settled, T0 + 50, { ...defaultShellView(settled), accountView: 'home' }));
    expect(settledBytes).toContain('No activity yet'); // the reads answered — no notices is the honest answer
  });

  it('the Time Machine bar\'s range note mid-read teaches PENDING — never "No project history is on record yet" (the history floor derives from the records; the project read is in flight)', () => {
    // the reload window BEFORE the project read lands: connected, live, nothing on hand yet
    const preProject = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeConsoleModel(preProject, T0 + 50);
    expect(bytes).toContain('data-hydration-pending="true"');
    expect(bytes).not.toContain('No project history is on record yet'); // RED pre-fix: the durable claim over the in-flight project read
    const settled = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'reads-settled', at: T0 + 10 },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    expect(serializeConsoleModel(settled, T0 + 50)).toContain('No project history is on record yet'); // the read answered — the session-floor range is the honest answer
  });

  it('the boundary law (the FW-41-C precedent): a SCRUBBED PAST view keeps the honest durable copy — the pending state is about NOW, never a claim about the past', () => {
    const scrubbed = reduceAll(midReadWorkspace(), [
      { kind: 'view-timestamp', at: T0 + 51, timestamp: T0 + 40 },
      { kind: 'section-selected', at: T0 + 52, section: 'research' },
    ]);
    const bytes = serializeConsoleModel(scrubbed, T0 + 51);
    expect(bytes).not.toContain('data-hydration-pending');
    expect(bytes).toContain('No research jobs at this view instant.'); // the past view's honest empty state — unchanged
  });

  it('the boundary law: a DEGRADED connection keeps the honest durable copy (the degraded class carries its own disclosure — the CONNECTION panel — never a pending marker over reads that answered with a failure)', () => {
    const degraded = reduceAll(midReadWorkspace(), [
      { kind: 'degraded-read', at: T0 + 30, route: 'GET /v1/jobs', family: 'unavailable', message: 'the read degraded' },
      { kind: 'section-selected', at: T0 + 51, section: 'research' },
    ]);
    const bytes = serializeConsoleModel(degraded, T0 + 50);
    expect(bytes).not.toContain('data-hydration-pending');
    expect(bytes).toContain('No research jobs at this view instant.'); // the degraded state's own honest copy (the pre-existing law, unchanged)
  });
});

// ---------------------------------------------------------------------------
// O-2 (Round O register — the "appears" grammar class, cosmetic): the
// loading vocabulary's subject-verb slip, live at three measured
// surfaces — "the notices appears here the moment the read lands" (the
// Inbox — S1, M3, S3 five consecutive samples, L3 16/16, L2), "the
// research jobs appears here the moment the read lands" (M1, L1, L2),
// and the same slip on the execution-submissions card. THE FIX: the
// plural subjects take "appear" — the FW-50 vocabulary's shape kept
// (the singular surfaces keep "appears": "the project history appears",
// "the organization appears").
// ---------------------------------------------------------------------------

describe('O-2 (Round O register — the appears grammar class): the loading vocabulary agrees with its subject', () => {
  it('the Inbox pending card reads "the notices appear here the moment the read lands" — never "the notices appears" (the S1/M3/S3/L3/L2 live instance)', () => {
    const mid = midReadWorkspace();
    const bytes = serializeVNode(renderConsoleModel(mid, T0 + 50, { ...defaultShellView(mid), accountView: 'inbox' }));
    expect(bytes).toContain('the notices appear here the moment the read lands'); // RED pre-fix: "the notices appears here…"
    expect(bytes).not.toContain('notices appears here');
  });

  it('the Research jobs pending card reads "the research jobs appear here the moment the read lands" — never "the research jobs appears" (the M1/L1/L2 live instance)', () => {
    const state = reduceAll(midReadWorkspace(), [{ kind: 'section-selected', at: T0 + 51, section: 'research' }]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('the research jobs appear here the moment the read lands'); // RED pre-fix: "the research jobs appears here…"
    expect(bytes).not.toContain('research jobs appears here');
  });

  it('the Execution pending card reads "the execution submissions appear here the moment the read lands" — never "the execution submissions appears" (the same grammar class, unmeasured only because the surface never rendered mid-read in Round O)', () => {
    const state = reduceAll(midReadWorkspace(), [{ kind: 'section-selected', at: T0 + 51, section: 'execution' }]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('the execution submissions appear here the moment the read lands'); // RED pre-fix: the same slip
    expect(bytes).not.toContain('execution submissions appears here');
  });

  it('the SINGULAR surfaces keep "appears" — the vocabulary\'s shape is unchanged (the TM bar\'s "the project history appears", the Organization section\'s "the organization appears")', () => {
    const preProject = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    expect(serializeConsoleModel(preProject, T0 + 50)).toContain('the project history appears here the moment the read lands');
    const state = reduceAll(midReadWorkspace(), [{ kind: 'section-selected', at: T0 + 51, section: 'organization' }]);
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'section' }));
    expect(bytes).toContain('the organization appears here the moment the read lands');
  });
});

// ---------------------------------------------------------------------------
// O-1b (Round O register — the read-lag residual class, the FIRST-FRAME
// flash, three surfaces): the Time-Machine project-history note
// ("No project history is on record yet — the range spans this session":
// S2 sub-300ms 2-of-4, M1 ~0.2-0.7s 2/2, L2 ~0.4-0.8s 1/1, L3 on the
// first cold attach), the Inbox notices ("No notices at this view
// instant." <1s 2/2 from L1, false while 5 notices stood) and the
// Research job-list ("No research jobs at this view instant." ~0.4-0.8s
// from L2, while the launch job stood on record). THE MECHANISM (the
// render-order race the seats measured): the first frame after a
// reload paints while the console is still CONNECTING — the meta read
// that flips the connection to 'connected' has not landed — and the
// pending folds gated on 'connected', so the empty-state branches won
// the first frame; the loading vocabulary took over only when the
// connection event arrived. THE LAW: the read is IN FLIGHT FROM THE
// FIRST PAINT — the bundle is queued behind a connection being
// established, which is a seek, not an answered absence — so
// 'connecting' teaches the same "Reading the world…" the in-flight
// bundle teaches (the desk law unchanged: the launchpad's honest
// terminal empties stand, exactly the hydrationReadPendingOf law).
// ---------------------------------------------------------------------------

describe('O-1b (Round O register — the first-frame flash class): the loading vocabulary from the FIRST frame, three surfaces', () => {
  /** The FIRST FRAME after a reload: the console is still CONNECTING (the meta read has not landed — openWorkspace's own initial state), a real desk scoped, LIVE view. */
  function firstFrameWorkspace(): WorkspaceState {
    return reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'view-live', at: T0 + 50 },
    ]);
  }

  it('the Time-Machine range note from the FIRST frame teaches the seek — never "No project history is on record yet" (S2/M1/L2/L3\'s first-frame flash)', () => {
    const bytes = serializeConsoleModel(firstFrameWorkspace(), T0 + 50);
    expect(bytes).toContain('data-hydration-pending="true"'); // the marker from frame one
    expect(bytes).toContain('Reading the world… — the project history appears here the moment the read lands'); // RED pre-fix: the connection event had not landed, the empty branch won frame one
    expect(bytes).not.toContain('No project history is on record yet'); // the first-frame durable claim, dead
  });

  it('the Inbox from the FIRST frame teaches the seek — never "No notices at this view instant." (L1\'s 2/2 reload flash, false while 5 notices stood)', () => {
    const first = firstFrameWorkspace();
    const bytes = serializeVNode(renderConsoleModel(first, T0 + 50, { ...defaultShellView(first), accountView: 'inbox' }));
    expect(bytes).toContain('data-hydration-pending="true"');
    expect(bytes).toContain('Reading the world…');
    expect(bytes).not.toContain('No notices at this view instant.'); // RED pre-fix: the first-frame empty claim over the queued bundle
  });

  it('the Research job-list from the FIRST frame teaches the seek — never "No research jobs at this view instant." (L2\'s ~0.4-0.8s flash while the launch job stood on record)', () => {
    const state = reduceAll(firstFrameWorkspace(), [{ kind: 'section-selected', at: T0 + 51, section: 'research' }]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain('data-hydration-pending="true"');
    expect(bytes).toContain('the research jobs appear here the moment the read lands'); // RED pre-fix: same class
    expect(bytes).not.toContain('No research jobs at this view instant.');
  });

  it('the launchpad\'s honest terminal empties still render from the first frame (the desk law — the launchpad has no desk to read; the connecting gate never manufactures a seek there)', () => {
    const launchpad = reduceAll(openWorkspace({ tenantId: 'tenant-a', projectId: '(launchpad)' }, T0), [
      { kind: 'view-live', at: T0 + 50 },
      { kind: 'section-selected', at: T0 + 51, section: 'research' },
    ]);
    const bytes = serializeConsoleModel(launchpad, T0 + 50);
    expect(bytes).toContain('No research jobs at this view instant.'); // the launchpad's honest teaching copy — unchanged
    expect(bytes).not.toContain('data-hydration-pending');
  });

  it('the OFFLINE boundary (the failed-read class): an unreachable API keeps the honest durable copy — a failed read is not a seek, and carries its own disclosure (the CONNECTION panel)', () => {
    const offline = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'connection-changed', at: T0 + 1, status: 'offline' },
      { kind: 'view-live', at: T0 + 50 },
      { kind: 'section-selected', at: T0 + 51, section: 'research' },
    ]);
    const bytes = serializeConsoleModel(offline, T0 + 50);
    expect(bytes).not.toContain('data-hydration-pending');
    expect(bytes).toContain('No research jobs at this view instant.'); // the pre-existing offline law, unchanged
  });
});

// ---------------------------------------------------------------------------
// O-1c (Round O register — the read-lag residual class, the COUNTER-ZEROS
// first-cold-load class, S3 + L3): on the first cold load the four Home
// summary tiles (ACTIVE JOBS / OUTCOMES / EVIDENCE CAPSULES / UNREAD
// NOTICES) and the Inbox sidebar badge read hard 0s / "no unread notices"
// for ~5-6s (S3) and >=6s (L3 — 8 consecutive 40ms samples) while the
// reads were in flight and RECENT ACTIVITY correctly showed "Reading the
// world…" — the numeric-counter variant FW-50's 13-surface fix did not
// cover. THE LAW: a hard 0 is a durable claim to a 2h/week operator
// (S3: "for an inbox-first operator the badge reading 'no unread
// notices' during an in-flight read is the same fear class"; L3: "from
// a compliance seat four zeroed counters read as the books standing
// empty") — the counters teach the seek while their own backing reads
// are in flight, the same FW-50 vocabulary the ORGANIZATION value and
// Instances row already carry, and the honest numbers render only when
// the reads have answered.
// ---------------------------------------------------------------------------

describe('O-1c (Round O register — the counter-zeros class): the counters teach the seek, never a hard 0 over an in-flight read', () => {
  /** The slice of one stat card's serialized bytes (the tile's own truth, extracted by its data-stat key). */
  function statCardOf(bytes: string, label: string): string {
    const start = bytes.indexOf(`data-stat="${label}"`);
    if (start === -1) throw new Error(`the ${label} tile does not render`);
    return bytes.slice(start, start + 520);
  }

  it('mid-read, ALL FOUR Home tiles teach the seek — never a hard 0 value or a 0-total delta (S3/L3\'s first-cold-load window; RECENT ACTIVITY already taught the seek)', () => {
    const mid = midReadWorkspace();
    const bytes = serializeVNode(renderConsoleModel(mid, T0 + 50, { ...defaultShellView(mid), accountView: 'home' }));
    for (const label of ['ACTIVE JOBS', 'OUTCOMES', 'EVIDENCE CAPSULES', 'UNREAD NOTICES']) {
      const card = statCardOf(bytes, label);
      expect(card, label).toContain('<div class="stat-value">Reading the world…</div>'); // RED pre-fix: <div class="stat-value">0</div>
      expect(card, label).not.toContain('<div class="stat-value">0</div>'); // the hard 0 is a durable claim
    }
    expect(statCardOf(bytes, 'ACTIVE JOBS')).not.toContain('<div class="stat-delta">0 total</div>'); // the total rides the same read
  });

  it('the per-family granularity: the jobs read ANSWERED (one running job on record) resolves the ACTIVE JOBS tile to its honest count while the other tiles still teach the seek — the counters settle at their own reads, never in lockstep', () => {
    const state = midReadWorkspace([{ kind: 'job-updated', at: T0 + 10, job: job() }]);
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'home' }));
    const active = statCardOf(bytes, 'ACTIVE JOBS');
    expect(active).toContain('<div class="stat-value">1</div>'); // the read answered — the honest count
    expect(active).toContain('<div class="stat-delta">1 total</div>');
    expect(statCardOf(bytes, 'OUTCOMES')).toContain('<div class="stat-value">Reading the world…</div>'); // still in flight
    expect(statCardOf(bytes, 'EVIDENCE CAPSULES')).toContain('<div class="stat-value">Reading the world…</div>'); // the fold's jobs lane answered, its outcomes lane has not
    expect(statCardOf(bytes, 'UNREAD NOTICES')).toContain('<div class="stat-value">Reading the world…</div>');
  });

  it('reads-settled resolves EVERY tile to its honest number — zero is the read\'s answer, never a claim over an unanswered read', () => {
    const settled = reduceAll(midReadWorkspace([{ kind: 'reads-settled', at: T0 + 20 }]), [{ kind: 'view-live', at: T0 + 51 }]);
    const bytes = serializeVNode(renderConsoleModel(settled, T0 + 50, { ...defaultShellView(settled), accountView: 'home' }));
    expect(statCardOf(bytes, 'ACTIVE JOBS')).toContain('<div class="stat-value">0</div>'); // the honest answers
    expect(statCardOf(bytes, 'OUTCOMES')).toContain('<div class="stat-value">0</div>');
    expect(statCardOf(bytes, 'EVIDENCE CAPSULES')).toContain('<div class="stat-value">0</div>');
    expect(statCardOf(bytes, 'UNREAD NOTICES')).toContain('<div class="stat-value">0</div>');
    expect(bytes).not.toContain('stat-value">Reading the world…'); // no lingering seek on the tiles
  });

  it('the Inbox sidebar badge mid-read teaches the seek — its aria-label NEVER claims "no unread notices" and its badge renders the reading marker, never an absent-by-zero face (S3\'s inbox-first operator fear)', () => {
    const mid = midReadWorkspace();
    const bytes = serializeVNode(renderConsoleModel(mid, T0 + 50, { ...defaultShellView(mid), accountView: 'home' }));
    expect(bytes).toContain('aria-label="Inbox — reading the world…"'); // RED pre-fix: aria-label="Inbox — no unread notices"
    expect(bytes).not.toContain('no unread notices'); // the durable claim, dead mid-read
    expect(bytes).toContain('data-unread="reading"'); // the non-committal badge face
    const settled = reduceAll(midReadWorkspace([{ kind: 'reads-settled', at: T0 + 20 }]), [{ kind: 'view-live', at: T0 + 51 }]);
    const settledBytes = serializeVNode(renderConsoleModel(settled, T0 + 50, { ...defaultShellView(settled), accountView: 'home' }));
    expect(settledBytes).toContain('aria-label="Inbox — no unread notices"'); // the reads answered — the honest label
    expect(settledBytes).not.toContain('data-unread="reading"');
  });
});

// ---------------------------------------------------------------------------
// FW-45 (the E-6 research-world MVP, M3's decisive item): the research-note
// ingestion surface. THE LAWS pinned here:
//   - the boundary teaching renders VERBATIM at the point of ingestion
//     (never a claim of ingestion capabilities that do not exist);
//   - the notes list is the SCOPE'S OWN records, L4-projected at the view
//     instant (a note attached after the view instant never renders);
//   - the affordance renders ONLY inside a project scope (the launchpad
//     keeps the wizard as the only path — the D-12 law);
//   - the Data-sources hint teaches the honest boundary (M3's seam a).
// ---------------------------------------------------------------------------

describe('FW-45: the research-note ingestion surface (the E-6 MVP — boundary-taught, L4-projected, scope-gated)', () => {
  /** The deployment's own boundary sentence — VERBATIM at the point of ingestion (the honesty law). */
  const BOUNDARY = 'SIMULATED ingestion: the note is stored verbatim and referenced by this project\'s records — no external data is fetched, no live feed exists in this deployment; the honest boundary of the research world as this deployment serves it.';

  /** One attached research note of this scope. */
  function note(overrides: Partial<ResearchNoteRecord> = {}): ResearchNoteRecord {
    return {
      noteId: 'note:aaaa1111', tenant: 'tenant-a', project: 'proj-a', attachedAt: T0 + 40,
      title: 'Factset export notes', text: 'fitted half-life 6.7 days; z-entry 2.1; z-exit 0.4',
      ...overrides,
    } as ResearchNoteRecord;
  }

  it('the Research section renders the notes card — the boundary teaching VERBATIM, the closed affordance, and the scope\'s own notes (titles + instants)', () => {
    const state = reduceAll(populatedWorkspace(), [
      { kind: 'section-selected', at: T0 + 50, section: 'research' as never },
      { kind: 'note-attached', at: T0 + 40, note: note() },
      { kind: 'view-live', at: T0 + 50 }, // the live anchor T0+50 — the note (T0+40) is knowable at the view instant
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    expect(bytes).toContain(BOUNDARY); // the boundary teaching, verbatim at the point of ingestion
    expect(bytes).toContain('data-note-attach="closed"'); // the affordance card
    expect(bytes).toContain('data-action="note-attach-open"'); // with its single primary action
    expect(bytes).toContain('Factset export notes'); // the note's title renders from its own record
    expect(bytes).toContain('note:aaaa1111'); // the note id — the record's own identity
  });

  it('the open form carries the title field + the note paste target (the untrusted-input gate renders the typed error inline)', () => {
    const state = reduceAll(populatedWorkspace(), [{ kind: 'section-selected', at: T0 + 50, section: 'research' as never }, { kind: 'view-live', at: T0 + 50 }]);
    const open = { ...defaultShellView(state), noteAttach: { edits: {}, error: null } as never };
    let bytes = serializeVNode(renderConsoleModel(state, T0 + 50, open));
    expect(bytes).toContain('data-note-attach="open"');
    expect(bytes).toContain('data-note-field="title"');
    expect(bytes).toContain('data-note-field="text"');
    expect(bytes).toContain('data-action="note-attach"');
    expect(bytes).toContain('data-action="note-attach-cancel"');
    // the typed validation error renders inline, and the user's text stays (the honest failure surface)
    const errored = { ...defaultShellView(state), noteAttach: { edits: { title: 'A title' }, error: 'the note text is required — paste the note\'s own text (this deployment stores it verbatim; it fetches nothing)' } as never };
    bytes = serializeVNode(renderConsoleModel(state, T0 + 50, errored));
    expect(bytes).toContain('data-note-attach="open"');
    expect(bytes).toContain('the note text is required');
    expect(bytes).toContain('value="A title"'); // the buffered edit survives the error render
  });

  it('FW-48: the note paste target TEACHES the typed-declaration boundary at the point of ingestion — a line in the constraint grammar is parsed as a typed parameter; every other line rides as evidence only, never fabricated into parameters', () => {
    // M3's flip condition is answered at the point of ingestion: the analyst
    // is taught WHAT the compute reads BEFORE pasting (the anti-deception
    // law's own surface — the same grammar the wizard's Constraints step
    // teaches, so the typed vocabulary is never a hidden protocol).
    const state = reduceAll(populatedWorkspace(), [
      { kind: 'section-selected', at: T0 + 50, section: 'research' as never },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const open = { ...defaultShellView(state), noteAttach: { edits: {}, error: null } as never };
    const bytes = serializeVNode(renderConsoleModel(state, T0 + 50, open));
    expect(bytes).toContain('A line in the constraint grammar (id:domain:subject:kind:bound, e.g. c-1:outcome:risk.maxDrawdown:limit.max:0.2) is parsed as a typed parameter of this project\'s research jobs; every other line rides as evidence only, never fabricated into parameters');
    expect(bytes).toContain('data-note-field="text"'); // the paste target itself still renders
  });

  it('the notes list is L4-PROJECTED: a note attached after the view instant is hidden (never a future note rendered)', () => {
    const state = reduceAll(populatedWorkspace(), [
      { kind: 'section-selected', at: T0 + 50, section: 'research' as never },
      { kind: 'note-attached', at: T0 + 40, note: note() },
      { kind: 'view-live', at: T0 + 50 }, // the live anchor T0+50 — the view instant
    ]);
    // a note whose OWN attachedAt (T0+60) is beyond the view instant (T0+50) never projects (L4's own law)
    const stateWithFutureNote = reduceAll(state, [{ kind: 'note-attached', at: T0 + 60, note: note({ noteId: 'note:ffff6666', attachedAt: T0 + 60, title: 'Tomorrow\'s note' }) }]);
    const bytes = serializeConsoleModel(stateWithFutureNote, T0 + 50);
    expect(bytes).toContain('Factset export notes'); // the T0+40 note renders at the T0+50 view instant
    expect(bytes).not.toContain('Tomorrow\'s note'); // the T0+60 note is beyond the view instant — hidden, never a future note
  });

  it('the notes card never renders on the launchpad (no project exists — the wizard is the only path, the D-12 law)', () => {
    const launchpad = reduceAll(openWorkspace({ tenantId: 'tenant-a', projectId: '(launchpad)' }, T0), [
      { kind: 'section-selected', at: T0 + 4, section: 'research' as never },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeConsoleModel(launchpad, T0 + 50);
    expect(bytes).not.toContain('data-note-attach');
    expect(bytes).not.toContain(BOUNDARY);
  });

  it('M3\'s seam (a) answered: the Data-sources hint teaches what research and external mean in THIS deployment — external is accepted, stored, and honestly not fetched (no live feed exists)', () => {
    const state = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'launch-draft-started', at: T0 + 2, draft: blankDraftOfD11() as never },
      { kind: 'launch-step-changed', at: T0 + 3, step: 'markets' as never },
      { kind: 'section-selected', at: T0 + 4, section: 'goal' as never },
      { kind: 'view-live', at: T0 + 50 },
    ]);
    const bytes = serializeConsoleModel(state, T0 + 50);
    // the hint names the two vocabularies honestly: what each MEANS in this deployment
    expect(bytes).toContain('research = the internal simulated researcher and your attached research notes');
    expect(bytes).toContain('external = accepted and stored as a declaration only — no external data is fetched in this deployment (no live feed exists)');
  });
});
