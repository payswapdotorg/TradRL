// @tradrl/web-console — THE RENDER MODEL.
//
// THE LAWS THIS MODEL ENFORCES IN CODE (Work Order T042, each a
// named typed error, each pinned by tests):
//
//   1. L4 at the interface — every visible datum passes the
//      availability projection: the model projects each section's
//      records to the Time Machine's view instant and calls
//      `assertVisible` per rendered datum; a post-availability fact
//      is the typed AvailabilityViolationError, never a wrong pixel.
//   2. L12 — every rendered record passes the scope gate; a record
//      of another tenant/project is the typed CrossTenantRenderError
//      (defense in depth: the ingest gates already refused it).
//   3. R37 — the watch feed renders UX.md's seven lenses from
//      sanitized watch events; the model re-projects them by
//      availability, and a submission verdict renders the gateway's
//      own verdict (a fabricated verdict is the typed
//      PolicyEnforcementError — L20: the console renders, never
//      re-decides).
//   4. The wall-clock law — the whole model pass runs inside
//      withRenderGuard at an injected instant; a wall-clock read
//      anywhere in it is the typed WallClockReadError.
//   5. Exact decimals — numeric records render verbatim (decimal
//      strings as strings; ratios via their canonical number form),
//      never reformatted, never float-math'd.
//
// The model is PURE: same (state, at) -> identical serialized VNode
// bytes (tests pin it). The DOM projector is a mechanical translation
// of this tree — no logic of its own.

import type { GatewaySubmissionRecord, JobRecord, OrgStatusSnapshot, OutcomeRecord, PostMortemRecord, ServedKnowledge } from '../api/contracts';
import { withRenderGuard } from '../core/clock';
import { assertVisible, availabilityOfJob, availabilityOfKnowledge, availabilityOfOrgSnapshot, availabilityOfOutcome, availabilityOfPostMortem, availabilityOfProject, availabilityOfSubmission, projectToView } from '../core/availability';
import { assertProjectScope, type WorkspaceScope } from '../core/tenant';
import { renderDecimal } from '../core/decimals';
import { formatDurationMs, formatInstantUtc } from '../core/format';
import { PolicyEnforcementError } from '../core/errors';
import { renderJobProgress, type JobProgressView } from '../core/launch';
import type { SectionId } from '../core/sections';
import { unreadCount, type InboxState } from '../core/notices';
import { capsuleFromKnowledge, capsuleFromOutcome, capsuleFromPostMortem, capsuleFromSubmission, type EvidenceCapsule } from '../core/evidence';
import { viewAtOf, watchEventsOf, type WorkspaceState } from '../core/workspace';
import { playbackProgressOf, type TimeMachineState } from '../core/timemachine';
import type { WatchEvent } from '../core/watch';
import { activeTargetOf, defaultShellView, heroPanel, renderAppShell, settingsPanel, type ShellView } from './shell';
import { v, serializeVNode, type VNode } from './vtree';

/** One fact row (closed-vocabulary label; the value verbatim). */
function factRow(label: string, value: string): VNode {
  return v('div', { class: 'fact' }, [
    v('span', { class: 'fact-label' }, [label]),
    v('span', { class: 'fact-value' }, [value]),
  ]);
}

/** A list of fact rows from pairs. */
function factRows(pairs: readonly (readonly [string, string])[]): VNode[] {
  return pairs.map(([label, value]) => factRow(label, value));
}

/** The section availability projection + render gate (L4) for one record. */
function visibleAt<T>(record: T, availableAt: number, viewAt: number, datumRef: string): T {
  assertVisible({ datumRef, availableAt }, viewAt);
  return record;
}

/** The verdict badge of a submission — the gateway's own verdict, verbatim (L20). */
export interface VerdictBadge {
  readonly kind: 'routed' | 'refused';
  readonly label: string;
  readonly detail: string;
}

/** Render the verdict badge of a submission from ITS OWN record (never fabricated). */
export function submissionVerdictBadgeOf(submission: GatewaySubmissionRecord): VerdictBadge {
  if (submission.kind === 'routed') {
    return { kind: 'routed', label: 'routed', detail: `venue ${submission.venue} at ${formatInstantUtc(submission.routedAt)}` };
  }
  return { kind: 'refused', label: 'refused', detail: `stage ${submission.refusal.stage} at ${formatInstantUtc(submission.refusedAt)}` };
}

/**
 * THE VERDICT-FAITHFULNESS GATE (L20): a badge may carry only the
 * gateway's own verdict. A fabricated or altered verdict (a refusal
 * rendered as routed, an approval the gateway never issued) is the
 * typed PolicyEnforcementError — the console renders policy, it
 * never re-decides it.
 */
export function assertVerdictFaithful(submission: GatewaySubmissionRecord, badge: VerdictBadge): void {
  const actual = submission.kind === 'routed' ? 'routed' : 'refused';
  if (badge.kind !== actual) {
    throw new PolicyEnforcementError(
      `the submission ${submission.submissionId} was ${actual} by the gateway but the render carries ${JSON.stringify(badge.kind)} — the console renders the gateway's verdict, it never re-decides it (L20)`,
    );
  }
}

/** Render one submission's card (verdict from the record; the gate proves faithfulness). */
function submissionCard(scope: WorkspaceScope, submission: GatewaySubmissionRecord, viewAt: number): VNode {
  visibleAt(submission, availabilityOfSubmission(submission), viewAt, submission.submissionId);
  const badge = submissionVerdictBadgeOf(submission);
  assertVerdictFaithful(submission, badge);
  return v('div', { class: `card verdict-${badge.kind}` }, [
    v('div', { class: 'card-title' }, [submission.submissionId]),
    v('span', { class: `badge badge-${badge.kind}` }, [badge.label]),
    factRow('verdict detail', badge.detail),
    factRow('audit', submission.auditId),
  ]);
}

/** Render one org snapshot. */
function orgSnapshotCard(scope: WorkspaceScope, snapshot: OrgStatusSnapshot, viewAt: number): VNode {
  assertProjectScope(scope, snapshot);
  visibleAt(snapshot, availabilityOfOrgSnapshot(snapshot), viewAt, snapshot.organizationRef);
  return v('div', { class: 'card' }, [
    v('div', { class: 'card-title' }, [snapshot.organizationRef]),
    v('span', { class: `badge badge-status-${snapshot.status}` }, [snapshot.status]),
    factRow('observed at', formatInstantUtc(snapshot.at)),
    factRow('instances', snapshot.instanceRefs.join(', ')),
  ]);
}

/** Render one job with its progress view. */
function jobCard(scope: WorkspaceScope, job: JobRecord, viewAt: number, progress: JobProgressView | null): VNode {
  assertProjectScope(scope, job);
  visibleAt(job, availabilityOfJob(job), viewAt, job.jobId);
  const rows: VNode[] = [
    factRow('kind', job.kind),
    factRow('status', job.status),
    factRow('submitted at', formatInstantUtc(job.submittedAt)),
  ];
  if (job.completedAt !== undefined) rows.push(factRow('completed at', formatInstantUtc(job.completedAt)));
  if (progress !== null) {
    rows.push(factRow('elapsed', progress.elapsedMs === null ? 'pending' : formatDurationMs(progress.elapsedMs)));
    rows.push(v('div', { class: 'progress' }, [
      v('span', { class: `progress-fill progress-${job.status}`, style: `width:${job.status === 'complete' ? '100' : job.status === 'running' ? '60' : '10'}%` }, []),
    ]));
  }
  return v('div', { class: 'card' }, [v('div', { class: 'card-title' }, [job.jobId]), ...rows]);
}

/** Render one outcome with its deviation facts (decimals verbatim). */
function outcomeCard(scope: WorkspaceScope, outcome: OutcomeRecord, viewAt: number): VNode {
  assertProjectScope(scope, outcome);
  visibleAt(outcome, availabilityOfOutcome(outcome), viewAt, outcome.outcomeId);
  return v('div', { class: 'card' }, [
    v('div', { class: 'card-title' }, [outcome.outcomeId]),
    v('span', { class: `badge badge-disposition-${outcome.decision.disposition}` }, [outcome.decision.disposition]),
    ...factRows([
      ['outcome class', outcome.outcomeClass],
      ['expected quantity', outcome.expectation.expectedQuantity ?? 'none'],
      ['filled quantity', outcome.realization.filledQuantity ?? 'none'],
      ['realized outcome', renderDecimal(outcome.realization.realizedOutcome)],
      ['fee total', renderDecimal(outcome.realization.feeTotal)],
      ['notional total', renderDecimal(outcome.realization.notionalTotal)],
      ['within tolerance', outcome.deviation.withinTolerance === null ? 'unknown' : String(outcome.deviation.withinTolerance)],
    ]),
  ]);
}

/** Render one post-mortem. */
function postMortemCard(scope: WorkspaceScope, postMortem: PostMortemRecord, viewAt: number): VNode {
  assertProjectScope(scope, { tenant: postMortem.lineage.tenant, project: postMortem.lineage.project });
  visibleAt(postMortem, availabilityOfPostMortem(postMortem), viewAt, postMortem.postMortemId);
  return v('div', { class: 'card' }, [
    v('div', { class: 'card-title' }, [postMortem.postMortemId]),
    ...factRows([
      ['outcome class', postMortem.subject.outcomeClass],
      ['disposition', postMortem.happened.disposition],
      ['realized outcome', renderDecimal(postMortem.happened.realizedOutcome)],
      ['realized gap', postMortem.gap.realizedGap ?? 'none'],
      ['within tolerance', postMortem.gap.withinTolerance === null ? 'unknown' : String(postMortem.gap.withinTolerance)],
      ['hypotheses', String(postMortem.hypotheses.length)],
    ]),
  ]);
}

/** Render one knowledge entry. */
function knowledgeCard(scope: WorkspaceScope, knowledge: ServedKnowledge, viewAt: number): VNode {
  assertProjectScope(scope, knowledge.record);
  visibleAt(knowledge, availabilityOfKnowledge(knowledge), viewAt, knowledge.record.knowledgeId);
  return v('div', { class: 'card' }, [
    v('div', { class: 'card-title' }, [knowledge.record.knowledgeId]),
    v('span', { class: `badge badge-knowledge-${knowledge.status}` }, [knowledge.status]),
    ...factRows([
      ['claim kind', knowledge.record.claim.kind],
      ['polarity', knowledge.record.claim.polarity],
      ['dimension', knowledge.record.claim.dimension ?? 'none'],
      ['confidence', knowledge.record.confidence],
      ['evidence count', String(knowledge.record.evidenceCount)],
      ['valid from', formatInstantUtc(knowledge.record.validity.from)],
      ['valid to', formatInstantUtc(knowledge.record.validity.to)],
    ]),
  ]);
}

/** Render one evidence capsule (its own availability gate — L4). */
function capsuleCard(capsule: EvidenceCapsule, viewAt: number): VNode {
  assertVisible({ datumRef: capsule.capsuleId, availableAt: capsule.availableAt }, viewAt);
  return v('div', { class: 'card capsule' }, [
    v('div', { class: 'card-title' }, [capsule.capsuleId]),
    v('span', { class: `badge badge-capsule-${capsule.sourceKind}` }, [capsule.sourceKind]),
    ...capsule.facts.map((entry) => factRow(entry.label, entry.value)),
    factRow('source route', capsule.sourceRoute),
    factRow('refs', capsule.refs.map((entry) => `${entry.kind}:${entry.ref}`).join(', ') || 'none'),
  ]);
}

/** Render one watch event — UX.md's seven lenses (the sanitized shape; never reasoning). */
function watchEventRow(scope: WorkspaceScope, event: WatchEvent, viewAt: number): VNode {
  visibleAt(event, event.at, viewAt, `watch:${event.decision?.ref ?? event.agent ?? 'unknown'}`);
  return v('div', { class: 'watch-event' }, [
    v('div', { class: 'watch-at' }, [formatInstantUtc(event.at)]),
    factRow('agent', event.agent ?? 'unknown'),
    factRow('capability', event.capability ?? 'unspecified'),
    factRow('evidence consulted', event.evidenceConsulted.map((entry) => `${entry.kind}:${entry.ref}`).join(', ') || 'none'),
    factRow('proposal', event.proposal ?? 'none'),
    factRow('challenge', event.challenge ?? 'none'),
    factRow('risk checks', event.riskChecks.map((check) => `${check.dimension}=${check.outcome}`).join(', ') || 'none'),
    factRow('decision', event.decision === null ? 'none' : `${event.decision.kind} ${event.decision.ref}`),
  ]);
}

/** The inbox panel (unread badge + the notices, projected by availability). */
function inboxPanel(state: WorkspaceState, viewAt: number): VNode {
  const unread = unreadCount(state.inbox);
  const projected = projectToView(state.inbox.notices, viewAt, (record) => record.at);
  const rows = projected.map((record) => v('div', { class: `notice notice-${record.kind}${state.inbox.readNoticeIds.includes(record.noticeId) ? ' read' : ' unread'}` }, [
    v('div', { class: 'notice-title' }, [record.title]),
    factRow('source', `${record.source.route} ${record.source.ref}`),
    ...record.facts.map((entry) => factRow(entry.label, entry.value)),
    factRow('at', formatInstantUtc(record.at)),
  ]));
  return v('aside', { class: 'inbox', 'data-unread': String(unread) }, [
    v('h2', {}, [`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`]),
    v('button', { class: 'inbox-read-all', 'data-action': 'notices-read-all', type: 'button' }, ['Mark all read']),
    ...rows,
    v('div', { class: 'inbox-empty' }, [projected.length === 0 ? 'No notices at this view instant.' : '']),
  ]);
}

/** The Time Machine bar (mode, anchor, view instant, playback progress, the controls). */
function timeMachineBar(state: WorkspaceState, viewAt: number): VNode {
  const progress = playbackProgressOf(state.timeMachine);
  return v('div', { class: 'timemachine', 'data-mode': state.timeMachine.mode }, [
    v('span', { class: 'tm-mode' }, [state.timeMachine.mode]),
    factRow('view', formatInstantUtc(viewAt)),
    factRow('anchor', formatInstantUtc(state.timeMachine.anchorAt)),
    ...(progress === null ? [] : [factRow('playback', `${Math.round(progress * 100)}%`)]),
    v('div', { class: 'tm-controls' }, [
      v('button', { class: 'tm-button', 'data-action': 'view-live', type: 'button' }, ['Live']),
      v('button', { class: 'tm-button', 'data-action': 'view-tminus', type: 'button' }, ['T-1m']),
      v('button', { class: 'tm-button', 'data-action': 'playback-start', type: 'button' }, ['Playback']),
    ]),
  ]);
}

/** The per-section panel — the selected section's projection at the view instant. */
function sectionPanel(state: WorkspaceState, viewAt: number): VNode {
  const scope = state.scope;
  switch (state.selectedSection) {
    case 'goal': {
      const rows: VNode[] = [];
      if (state.project !== null) {
        visibleAt(state.project, availabilityOfProject(state.project), viewAt, state.project.id);
        rows.push(v('div', { class: 'card' }, [
          v('div', { class: 'card-title' }, [state.project.name]),
          ...factRows([
            ['project', state.project.id],
            ['tenant', state.project.tenantId],
            ['lifecycle', state.project.lifecycle.status],
            ['execution mode', state.project.executionMode],
            ['goal ref', `${state.project.lineage.goal.goalId}@${state.project.lineage.goal.version}`],
            ['constraint set', `${state.project.lineage.constraintSet.id}@${state.project.lineage.constraintSet.version}`],
          ]),
        ]));
      }
      if (state.goal !== null) {
        rows.push(v('div', { class: 'card' }, [
          v('div', { class: 'card-title' }, ['Goal statement']),
          v('p', { class: 'objective' }, [state.goal.objective]),
          ...factRows([
            ['horizon', `${formatInstantUtc(state.goal.horizon.startsAt)} -> ${formatInstantUtc(state.goal.horizon.endsAt)}`],
            ['horizon label', state.goal.horizon.label ?? 'none'],
            ['required satisfaction', String(state.goal.successCriteria.requiredSatisfaction)],
            ['adversarial required', String(state.goal.evaluation.adversarialRequired)],
          ]),
          ...state.goal.successCriteria.criteria.map((criterion) => factRow(`criterion ${criterion.id}`, `${criterion.metric} ${criterion.predicate.kind}`)),
        ]));
      }
      if (state.constraintSet !== null) {
        rows.push(v('div', { class: 'card' }, [
          v('div', { class: 'card-title' }, ['Constraints']),
          ...state.constraintSet.constraints.map((constraint) => factRow(`${constraint.severity} ${constraint.id}`, `${constraint.domain}.${constraint.subject} ${constraint.predicate.kind}`)),
        ]));
      }
      if (rows.length === 0) rows.push(v('div', { class: 'empty' }, ['No goal loaded yet.']));
      return v('section', { class: 'panel', 'data-section': 'goal' }, rows);
    }

    case 'organization': {
      const projected = projectToView(state.orgSnapshots, viewAt, availabilityOfOrgSnapshot);
      const cards = projected.map((snapshot) => orgSnapshotCard(scope, snapshot, viewAt));
      return v('section', { class: 'panel', 'data-section': 'organization' }, [
        ...cards,
        v('div', { class: 'empty' }, [projected.length === 0 ? 'No organization snapshots at this view instant.' : '']),
      ]);
    }

    case 'market-world': {
      const draft = state.launch.draft;
      if (draft === null) {
        return v('section', { class: 'panel', 'data-section': 'market-world' }, [v('div', { class: 'empty' }, ['No launch context yet — the market world is specified at launch.'])]);
      }
      return v('section', { class: 'panel', 'data-section': 'market-world' }, [
        v('div', { class: 'card' }, [
          v('div', { class: 'card-title' }, ['Market world (launch context)']),
          ...factRows([
            ['markets', draft.markets.join(', ')],
            ['venues', draft.venues.join(', ')],
            ['data sources', draft.dataSources.join(', ')],
            ['execution mode', draft.executionMode],
            ['capital budget', renderDecimal(draft.capitalBudget)],
            ['risk budget', renderDecimal(draft.riskBudget)],
            ['horizon', `${formatInstantUtc(draft.horizon.startsAt)} -> ${formatInstantUtc(draft.horizon.endsAt)}`],
          ]),
        ]),
      ]);
    }

    case 'time-machine': {
      const knowable: VNode[] = [
        factRow('view instant', formatInstantUtc(viewAt)),
        factRow('mode', state.timeMachine.mode),
        factRow('anchor instant', formatInstantUtc(state.timeMachine.anchorAt)),
        factRow('t-minus offset', `${state.timeMachine.tMinusMs}ms`),
        factRow('playback', state.timeMachine.playback === null ? 'not armed' : `from ${formatInstantUtc(state.timeMachine.playback.fromAt)} step ${state.timeMachine.playback.stepMs}ms after ${state.timeMachine.playback.ticks} ticks`),
      ];
      return v('section', { class: 'panel', 'data-section': 'time-machine' }, [
        v('div', { class: 'card' }, [v('div', { class: 'card-title' }, ['Time Machine']), ...knowable]),
        v('p', { class: 'hint' }, ['Every visible datum above passed the availability projection for this view instant (L4).']),
      ]);
    }

    case 'research': {
      const projected = projectToView(state.jobs.filter((job) => job.kind === 'research'), viewAt, availabilityOfJob);
      const cards = projected.map((job) => jobCard(scope, job, viewAt, renderJobProgress(state.launch.jobId === job.jobId ? state.launch.progress : [])));
      return v('section', { class: 'panel', 'data-section': 'research' }, [
        ...cards,
        v('div', { class: 'empty' }, [projected.length === 0 ? 'No research jobs at this view instant.' : '']),
      ]);
    }

    case 'experiments': {
      const projected = projectToView(state.jobs, viewAt, availabilityOfJob);
      const experiments = new Map<string, string>();
      for (const outcome of projectToView(state.outcomes, viewAt, availabilityOfOutcome)) {
        if (outcome.lineage.experiment !== null) experiments.set(outcome.lineage.experiment.experimentRef, outcome.lineage.experiment.trialRef);
      }
      const cards = projected.map((job) => jobCard(scope, job, viewAt, null));
      return v('section', { class: 'panel', 'data-section': 'experiments' }, [
        v('div', { class: 'card' }, [
          v('div', { class: 'card-title' }, ['Experiment lineage']),
          ...[...experiments.entries()].map(([experimentRef, trialRef]) => factRow(experimentRef, `trial ${trialRef}`)),
          ...(experiments.size === 0 ? [factRow('experiments', 'none at this view instant')] : []),
        ]),
        ...cards,
      ]);
    }

    case 'decisions': {
      const submissions = projectToView(state.submissions, viewAt, availabilityOfSubmission);
      const watchFeed = projectToView(watchEventsOf(state), viewAt, (event) => event.at);
      return v('section', { class: 'panel', 'data-section': 'decisions' }, [
        v('div', { class: 'watch' }, [v('h2', {}, ['Watch']), ...watchFeed.map((event) => watchEventRow(scope, event, viewAt))]),
        ...submissions.map((submission) => submissionCard(scope, submission, viewAt)),
        v('div', { class: 'empty' }, [submissions.length === 0 ? 'No decisions at this view instant.' : '']),
      ]);
    }

    case 'execution': {
      const submissions = projectToView(state.submissions, viewAt, availabilityOfSubmission);
      return v('section', { class: 'panel', 'data-section': 'execution' }, [
        v('p', { class: 'hint' }, ['The console submits execution REQUESTS through the API; the gateway alone decides (L8/L20).']),
        ...submissions.map((submission) => submissionCard(scope, submission, viewAt)),
        v('div', { class: 'empty' }, [submissions.length === 0 ? 'No execution submissions at this view instant.' : '']),
      ]);
    }

    case 'risk': {
      const rows: VNode[] = [];
      if (state.constraintSet !== null) {
        rows.push(v('div', { class: 'card' }, [
          v('div', { class: 'card-title' }, ['Constraint set']),
          ...state.constraintSet.constraints.map((constraint) => factRow(`${constraint.severity} ${constraint.id}`, `${constraint.domain}.${constraint.subject} ${constraint.predicate.kind}`)),
        ]));
      }
      const riskPolicies = new Map<string, string>();
      for (const outcome of projectToView(state.outcomes, viewAt, availabilityOfOutcome)) {
        riskPolicies.set(outcome.lineage.shadow.riskPolicy.policyId, `v${outcome.lineage.shadow.riskPolicy.version}`);
      }
      rows.push(v('div', { class: 'card' }, [
        v('div', { class: 'card-title' }, ['Risk policies (outcome lineage)']),
        ...[...riskPolicies.entries()].map(([policyId, version]) => factRow(policyId, version)),
        ...(riskPolicies.size === 0 ? [factRow('risk policies', 'none at this view instant')] : []),
      ]));
      return v('section', { class: 'panel', 'data-section': 'risk' }, rows);
    }

    case 'evidence': {
      const capsules: EvidenceCapsule[] = [
        ...projectToView(state.outcomes, viewAt, availabilityOfOutcome).map((outcome) => capsuleFromOutcome(scope, outcome)),
        ...projectToView(state.postMortems, viewAt, availabilityOfPostMortem).map((postMortem) => capsuleFromPostMortem(scope, postMortem)),
        ...projectToView(state.knowledge, viewAt, availabilityOfKnowledge).map((knowledge) => capsuleFromKnowledge(scope, knowledge)),
        ...projectToView(state.submissions, viewAt, availabilityOfSubmission).map((submission) => capsuleFromSubmission(scope, submission)),
      ];
      return v('section', { class: 'panel', 'data-section': 'evidence' }, [
        ...capsules.map((capsule) => capsuleCard(capsule, viewAt)),
        v('div', { class: 'empty' }, [capsules.length === 0 ? 'No evidence capsules at this view instant.' : '']),
      ]);
    }

    case 'outcomes': {
      const projected = projectToView(state.outcomes, viewAt, availabilityOfOutcome);
      const cards = projected.map((outcome) => outcomeCard(scope, outcome, viewAt));
      return v('section', { class: 'panel', 'data-section': 'outcomes' }, [
        ...cards,
        v('div', { class: 'empty' }, [projected.length === 0 ? 'No outcomes at this view instant.' : '']),
      ]);
    }

    case 'lessons': {
      const knowledgeProjected = projectToView(state.knowledge, viewAt, availabilityOfKnowledge);
      const postMortemProjected = projectToView(state.postMortems, viewAt, availabilityOfPostMortem);
      return v('section', { class: 'panel', 'data-section': 'lessons' }, [
        ...knowledgeProjected.map((knowledge) => knowledgeCard(scope, knowledge, viewAt)),
        ...postMortemProjected.map((postMortem) => postMortemCard(scope, postMortem, viewAt)),
        v('div', { class: 'empty' }, [knowledgeProjected.length + postMortemProjected.length === 0 ? 'No lessons at this view instant.' : '']),
      ]);
    }
  }
}

/** The launch panel (the primary flow's wizard + progress). */
function launchPanel(state: WorkspaceState, viewAt: number): VNode {
  const launch = state.launch;
  const progress = renderJobProgress(launch.progress);
  const rows: VNode[] = [];
  if (launch.draft !== null) {
    rows.push(v('div', { class: 'card' }, [
      v('div', { class: 'card-title' }, [`Launch (${launch.phase})`]),
      ...factRows([
        ['step', launch.step],
        ['name', launch.draft.name],
        ['objective', launch.draft.objective],
        ['capital budget', renderDecimal(launch.draft.capitalBudget)],
        ['risk budget', renderDecimal(launch.draft.riskBudget)],
        ['markets', launch.draft.markets.join(', ')],
        ['venues', launch.draft.venues.join(', ')],
        ['data', launch.draft.dataSources.join(', ')],
        ['execution mode', launch.draft.executionMode],
      ]),
    ]));
  }
  if (progress !== null) {
    rows.push(v('div', { class: 'card' }, [
      v('div', { class: 'card-title' }, ['Launch progress']),
      ...factRows([
        ['phase', progress.phase],
        ['submitted at', progress.submittedAt === null ? 'unknown' : formatInstantUtc(progress.submittedAt)],
        ['completed at', progress.completedAt === null ? 'pending' : formatInstantUtc(progress.completedAt)],
        ['elapsed', progress.elapsedMs === null ? 'pending' : formatDurationMs(progress.elapsedMs)],
      ]),
      v('div', { class: 'progress' }, [
        v('span', { class: `progress-fill progress-${progress.phase}`, style: `width:${progress.phase === 'complete' ? '100' : progress.phase === 'running' ? '60' : progress.phase === 'submitted' ? '10' : '0'}%` }, []),
      ]),
    ]));
  }
  if (launch.error !== null) rows.push(v('div', { class: 'card error-card' }, [v('div', { class: 'card-title' }, ['Launch failed']), factRow('error', launch.error)]));
  if (rows.length === 0) rows.push(v('div', { class: 'empty' }, ['No launch in progress. Start one from the primary flow.']));
  void viewAt;
  return v('section', { class: 'panel launch', 'data-section': 'launch' }, rows);
}

/**
 * THE WHOLE-CONSOLE RENDER MODEL: one pure pass at an injected
 * instant. The wall-clock guard is armed for the entire pass; every
 * record passes its availability gate and its scope gate; every
 * verdict renders the gateway's own. Determinism: identical
 * (state, at, view) -> identical serializeVNode bytes.
 *
 * The T051 shell (render/shell.ts) wraps the panels: the sidebar's
 * grouped navigation, the CONNECTION block and the per-section page
 * scaffold (H1 + subtitle + status badge + actions) are CHROME — the
 * section panels and every law gate inside them are T042 law,
 * unchanged. The optional shell view carries only chrome state
 * (theme, the account landing target, endpoint, simulated flag,
 * busy/drawer states); the default view reproduces the classic
 * section render.
 */
export function renderConsoleModel(state: WorkspaceState, at: number, view: ShellView = defaultShellView(state)): VNode {
  return withRenderGuard(() => {
    const viewAt = viewAtOf(state);
    const activeTarget = activeTargetOf(state, view);
    const main: VNode = activeTarget === 'home'
      ? heroPanel()
      : activeTarget === 'inbox'
        ? inboxPanel(state, viewAt)
        : activeTarget === 'settings'
          ? settingsPanel(state, view)
          : sectionPanel(state, viewAt);
    const launch = activeTarget === 'inbox' || activeTarget === 'settings' ? null : launchPanel(state, viewAt);
    return renderAppShell(state, at, view, activeTarget, {
      timeMachine: timeMachineBar(state, viewAt),
      main,
      launch,
    });
  });
}

/** Serialize the whole-console model (the render determinism pin). */
export function serializeConsoleModel(state: WorkspaceState, at: number): string {
  return serializeVNode(renderConsoleModel(state, at));
}
