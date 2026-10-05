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
import { renderJobProgress, LAUNCH_STEPS, type JobProgressView, type LaunchStep } from '../core/launch';
import {
  EXECUTION_MODES,
  constraintGrammarExample,
  launchDraftProblems,
  launchFieldValidation,
  launchFormValues,
  type LaunchFormValues,
  type LaunchFieldName,
} from '../core/launch-form';
import type { SectionId } from '../core/sections';
import { unreadCount, type InboxState } from '../core/notices';
import { capsuleFromKnowledge, capsuleFromOutcome, capsuleFromPostMortem, capsuleFromSubmission, type EvidenceCapsule } from '../core/evidence';
import { viewAtOf, watchEventsOf, type WorkspaceState } from '../core/workspace';
import { playbackProgressOf, type TimeMachineState } from '../core/timemachine';
import type { WatchEvent } from '../core/watch';
import { timelineBucketsOf, formatTimeUtc, type TimelineEntry } from '../core/timeline';
import { activeTargetOf, defaultShellView, heroPanel, renderAppShell, settingsPanel, type SheetRef, type ShellView } from './shell';
// The onboarding wizard's only render is renderAppShell's §4.13 modal
// overlay (render/shell.ts) — this model never imports it (the W-10b
// double-render fix: one wizard, one copy, one place).
import {
  accordionRow,
  detailSheet,
  emptyState,
  errorState,
  listRow,
  loadingState,
  pillToneOfDomain,
  richStatCard,
  statCard,
  statGrid,
  timelineList,
  type ComponentIcon,
  type DefinitionSection,
  type PillTone,
} from './components';
import {
  capsuleSurface,
  labeledInput,
  labeledSelect,
  noticeCopyOf,
  notificationBell,
  reviewStep,
  streamCard,
  timeMachineControls,
  twoStepConfirm,
} from './flow';
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

/** Render one job as an interactive list row (§4.4) — the facts live in the sheet (§4.5a). */
function jobPillOf(job: JobRecord): { tone: PillTone; label: string } {
  const status = job.status as 'submitted' | 'running' | 'complete' | 'failed' | 'blocked';
  return { tone: pillToneOfDomain(status), label: job.status };
}

/** Render one job with its progress view. */
function jobCard(scope: WorkspaceScope, job: JobRecord, viewAt: number, progress: JobProgressView | null): VNode {
  assertProjectScope(scope, job);
  visibleAt(job, availabilityOfJob(job), viewAt, job.jobId);
  return listRow({
    icon: 'flask',
    title: job.jobId,
    subtitle: `${job.kind} job`,
    pill: jobPillOf(job),
    ...(progress !== null && progress.elapsedMs !== null ? { meta: formatDurationMs(progress.elapsedMs) } : {}),
    rowId: `job:${job.jobId}`,
  });
}

/** The job's detail sheet (§4.5a) — the same availability + scope gates as the row. */
function jobSheet(scope: WorkspaceScope, job: JobRecord, viewAt: number, progress: JobProgressView | null): VNode[] {
  assertProjectScope(scope, job);
  visibleAt(job, availabilityOfJob(job), viewAt, job.jobId);
  const status: DefinitionSection = {
    eyebrow: 'STATUS',
    pairs: [
      ['state', job.status],
      ['submitted at', formatInstantUtc(job.submittedAt)],
      ...(job.completedAt !== undefined ? ([['completed at', formatInstantUtc(job.completedAt)]] as const) : []),
    ],
  };
  const metrics: DefinitionSection = {
    eyebrow: 'METRICS',
    pairs: [['elapsed', progress === null || progress.elapsedMs === null ? 'pending' : formatDurationMs(progress.elapsedMs)]],
  };
  const identity: DefinitionSection = {
    eyebrow: 'IDENTITY',
    pairs: [['job id', job.jobId], ['kind', job.kind], ['project', job.project]],
  };
  return detailSheet({ sheetId: `job:${job.jobId}`, title: job.jobId, subtitle: `${job.kind} job`, details: [status, metrics, identity] });
}

/** Render one org snapshot as an interactive list row. */
function orgSnapshotCard(scope: WorkspaceScope, snapshot: OrgStatusSnapshot, viewAt: number): VNode {
  assertProjectScope(scope, snapshot);
  visibleAt(snapshot, availabilityOfOrgSnapshot(snapshot), viewAt, snapshot.organizationRef);
  return listRow({
    icon: 'layers',
    title: snapshot.organizationRef,
    subtitle: `${snapshot.instanceRefs.length} instance${snapshot.instanceRefs.length === 1 ? '' : 's'}`,
    pill: { tone: snapshot.status === 'active' ? 'live' : 'idle', label: snapshot.status },
    meta: formatTimeUtc(snapshot.at),
    rowId: `snapshot:${snapshot.organizationRef}`,
  });
}

/** The snapshot's detail sheet. */
function snapshotSheet(scope: WorkspaceScope, snapshot: OrgStatusSnapshot, viewAt: number): VNode[] {
  assertProjectScope(scope, snapshot);
  visibleAt(snapshot, availabilityOfOrgSnapshot(snapshot), viewAt, snapshot.organizationRef);
  return detailSheet({
    sheetId: `snapshot:${snapshot.organizationRef}`,
    title: snapshot.organizationRef,
    subtitle: 'organization snapshot',
    details: [
      { eyebrow: 'STATUS', pairs: [['state', snapshot.status], ['observed at', formatInstantUtc(snapshot.at)]] },
      { eyebrow: 'IDENTITY', pairs: [['organization', snapshot.organizationRef], ['project', snapshot.project], ['instances', snapshot.instanceRefs.join(', ') || 'none']] },
    ],
  });
}

/** Render one outcome as an accordion row (§4.5b) — decimals verbatim in the definition grid. */
function outcomeCard(scope: WorkspaceScope, outcome: OutcomeRecord, viewAt: number): VNode {
  assertProjectScope(scope, outcome);
  visibleAt(outcome, availabilityOfOutcome(outcome), viewAt, outcome.outcomeId);
  return accordionRow({
    icon: 'chart',
    title: outcome.outcomeId,
    subtitle: outcome.outcomeClass,
    pill: { tone: outcome.deviation.withinTolerance === false ? 'warn' : 'live', label: outcome.decision.disposition },
    meta: formatTimeUtc(outcome.asOf),
    rowId: `outcome:${outcome.outcomeId}`,
    details: [
      { eyebrow: 'STATUS', pairs: [
        ['disposition', outcome.decision.disposition],
        ['within tolerance', outcome.deviation.withinTolerance === null ? 'unknown' : String(outcome.deviation.withinTolerance)],
        ['realized gap', outcome.deviation.realizedGap ?? 'none'],
      ] },
      { eyebrow: 'METRICS', pairs: [
        ['expected quantity', outcome.expectation.expectedQuantity ?? 'none'],
        ['filled quantity', outcome.realization.filledQuantity ?? 'none'],
        ['realized outcome', renderDecimal(outcome.realization.realizedOutcome)],
        ['fee total', renderDecimal(outcome.realization.feeTotal)],
        ['notional total', renderDecimal(outcome.realization.notionalTotal)],
      ] },
      { eyebrow: 'IDENTITY', pairs: [
        ['outcome id', outcome.outcomeId],
        ['outcome class', outcome.outcomeClass],
        ['evidence', outcome.evidence.map((entry) => `${entry.kind}:${entry.ref}`).join(', ') || 'none'],
      ] },
      { eyebrow: 'ADVANCED', pairs: [
        ['decision ref', outcome.decision.decisionRef],
        ['intent ref', outcome.decision.intentRef],
        ['as of', formatInstantUtc(outcome.asOf)],
      ] },
    ],
  });
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

/** Render one evidence capsule as the §4.9 inline surface: the monospace content-address badge (the open button) + the source kind; when open, the payload (mono) + the provenance line render inline (refs — never recomputed, L20). */
function capsuleCard(capsule: EvidenceCapsule, viewAt: number, openCapsule: string | null): VNode {
  assertVisible({ datumRef: capsule.capsuleId, availableAt: capsule.availableAt }, viewAt);
  return capsuleSurface({
    capsuleId: capsule.capsuleId,
    sourceKind: capsule.sourceKind,
    open: openCapsule === capsule.capsuleId,
    payloadLines: [
      ...capsule.facts.map((entry) => `${entry.label}: ${entry.value}`),
      capsule.refs.length === 0 ? 'refs: none' : `refs: ${capsule.refs.map((entry) => `${entry.kind}:${entry.ref}`).join(', ')}`,
    ],
    provenance: `read from ${capsule.sourceRoute} · ${capsule.sourceKind} ${capsule.sourceRef} · tenant ${capsule.tenantId} / project ${capsule.projectId} · available ${formatInstantUtc(capsule.availableAt)}`,
  });
}

/** The inline capsule badge of one record (the J7 “capsules render inline from Outcomes / Decisions” half): the record's own content-address badge, opening the same payload surface. */
function capsuleInline(capsule: EvidenceCapsule, viewAt: number, openCapsule: string | null): VNode {
  return capsuleCard(capsule, viewAt, openCapsule);
}

/** Render one watch event as a §4.7 stream card (the sanitized seven-lens shape; the chain-of-thought firewall is upstream at ingest — unchanged). */
function watchEventRow(scope: WorkspaceScope, event: WatchEvent, viewAt: number, openCapsule: string | null): VNode {
  void scope;
  visibleAt(event, event.at, viewAt, `watch:${event.decision?.ref ?? event.agent ?? 'unknown'}`);
  return streamCard({
    agent: event.agent ?? 'unknown',
    capability: event.capability,
    evidenceConsulted: event.evidenceConsulted,
    proposal: event.proposal,
    challenge: event.challenge,
    riskChecks: event.riskChecks,
    decision: event.decision,
    at: event.at,
    openRef: openCapsule,
  });
}

/** The inbox panel (§4.10): the bell + list rows with read/unread state + mark-all-read. */
function inboxPanel(state: WorkspaceState, viewAt: number): VNode {
  const unread = unreadCount(state.inbox);
  const projected = projectToView(state.inbox.notices, viewAt, (record) => record.at);
  const rows = projected.map((record) => {
    const copy = noticeCopyOf(record.kind);
    const isRead = state.inbox.readNoticeIds.includes(record.noticeId);
    return accordionRow({
      icon: copy.icon,
      title: record.title,
      subtitle: copy.sentence,
      ...(isRead ? {} : { pill: { tone: 'live' as PillTone, label: 'new' } }),
      meta: formatTimeUtc(record.at),
      rowId: `notice:${record.noticeId}`,
      attrs: { class: `list-row accordion-row notice notice-${record.kind}${isRead ? ' read' : ' unread'}` },
      details: [
        { eyebrow: 'STATUS', pairs: [['read', isRead ? 'yes' : 'no'], ['at', formatInstantUtc(record.at)]] },
        { eyebrow: 'IDENTITY', pairs: [['notice id', record.noticeId], ['event type', record.kind]] },
        { eyebrow: 'ADVANCED', pairs: [['source route', record.source.route], ['source ref', record.source.ref], ...record.facts.map((entry) => [entry.label, entry.value] as const)] },
      ],
    });
  });
  return v('aside', { class: 'inbox', 'data-unread': String(unread) }, [
    v('h2', {}, [`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`]),
    v('button', { class: 'inbox-read-all', 'data-action': 'notices-read-all', type: 'button' }, ['Mark all read']),
    ...rows,
    ...(projected.length === 0 ? [sectionEmpty('inbox')] : []),
  ]);
}

/** The Time Machine bar (§4.8): the mode select, the scrubber, the playback controls, the mono readout, the projection notice. */
function timeMachineBar(state: WorkspaceState, viewAt: number): VNode {
  const progress = playbackProgressOf(state.timeMachine);
  return v('div', { class: 'timemachine', 'data-mode': state.timeMachine.mode }, [
    timeMachineControls({
      mode: state.timeMachine.mode,
      viewAt,
      openedAt: state.openedAt,
      anchorAt: state.timeMachine.anchorAt,
      playing: state.timeMachine.mode === 'playback',
      progress,
    }),
    v('p', { class: 'hint' }, ['Every visible datum passed the availability projection for this view instant (L4).']),
  ]);
}

/** The per-section teaching empty states (§4.12): the pinned T042 titles + ONE sentence + exactly ONE action. */
const SECTION_EMPTY_STATES: Readonly<Record<SectionId | 'inbox', { readonly icon: ComponentIcon; readonly title: string; readonly sentence: string; readonly action: { readonly label: string; readonly target?: string; readonly action?: string } }>> = Object.freeze({
  'inbox': { icon: 'inbox', title: 'No notices at this view instant.', sentence: 'Notifications from your organization appear here as they happen.', action: { label: 'Open the overview', target: 'home' } },
  // THE J3 ENTRY (the primary flow starts here): the Goal section's
  // single primary action STARTS the guided launch wizard — a
  // delegated action (data-action="launch-start"), never a
  // navigation target (the click handler's nav branch would swallow
  // it before the action branch could run).
  'goal': { icon: 'target', title: 'No goal loaded yet.', sentence: 'Describe what this organization should achieve, then launch the primary flow.', action: { label: 'Describe your goal', action: 'launch-start' } },
  'organization': { icon: 'layers', title: 'No organization snapshots at this view instant.', sentence: 'An organization compiles here once the launch completes.', action: { label: 'Describe a goal', target: 'goal' } },
  'market-world': { icon: 'pulse', title: 'No launch context yet — the market world is specified at launch.', sentence: 'Markets, venues and data sources appear once a project launches.', action: { label: 'Open Goal', target: 'goal' } },
  'time-machine': { icon: 'clock', title: 'No view yet.', sentence: 'Pick a mode above to revisit any instant.', action: { label: 'Open the overview', target: 'home' } },
  'research': { icon: 'flask', title: 'No research jobs at this view instant.', sentence: 'Research jobs start when a project launches.', action: { label: 'Launch from Goal', target: 'goal' } },
  'experiments': { icon: 'flask', title: 'No experiments yet.', sentence: 'Run your first evaluation from Research.', action: { label: 'Open Research', target: 'research' } },
  'decisions': { icon: 'check', title: 'No decisions at this view instant.', sentence: 'Proposals and decisions appear once research produces candidates.', action: { label: 'Open Research', target: 'research' } },
  'execution': { icon: 'pulse', title: 'No execution submissions at this view instant.', sentence: 'Executions follow the decisions your organization makes.', action: { label: 'Open Decisions', target: 'decisions' } },
  'risk': { icon: 'shield', title: 'No risk records at this view instant.', sentence: 'Risk checks appear once the organization acts.', action: { label: 'Open Decisions', target: 'decisions' } },
  'evidence': { icon: 'box', title: 'No evidence capsules at this view instant.', sentence: 'Every outcome, lesson and decision carries its evidence here.', action: { label: 'Open Outcomes', target: 'outcomes' } },
  'outcomes': { icon: 'chart', title: 'No outcomes at this view instant.', sentence: 'Realized outcomes appear once executions settle.', action: { label: 'Open Execution', target: 'execution' } },
  'lessons': { icon: 'spark', title: 'No lessons at this view instant.', sentence: 'The firm records what it learns from realized outcomes.', action: { label: 'Open Outcomes', target: 'outcomes' } },
});

/** The section's teaching empty state (the pinned title rides as the EmptyState title). */
function sectionEmpty(section: SectionId | 'inbox'): VNode {
  const config = SECTION_EMPTY_STATES[section];
  return emptyState({ icon: config.icon, title: config.title, sentence: config.sentence, action: config.action });
}

/** The notice-kind severity tint (§4.6 — a closed mapping, pinned by tests). */
function noticeSeverityOf(kind: string): 'info' | 'warn' | 'error' {
  if (kind === 'failed_evaluation' || kind === 'safety_intervention') return 'error';
  if (kind === 'capability_gap' || kind === 'shadow_degradation') return 'warn';
  return 'info';
}

/**
 * The Home teaching-state freshness gate (§4.12, exported for the app
 * layer's J9 triage): true while the workspace knows NOTHING yet (no
 * project, no jobs, no outcomes) — the loading skeleton renders while
 * connecting, the ErrorState renders when offline. app/console.ts's
 * read cadence consults the SAME gate when deciding whether a
 * transport-level failure means the API is UNREACHABLE (nothing to
 * show) rather than degraded (the last known world still renders).
 */
export function homeFresh(state: WorkspaceState): boolean {
  return state.project === null && state.jobs.length === 0 && state.outcomes.length === 0;
}

/**
 * THE HOME PANEL (§3: the hero IS the page) — the overview surface:
 * the hero, the KPI tiles (§4.1), the rich stat card (§4.2) and the
 * activity timeline (§4.6, from the notice fold — projected by
 * availability like every other datum). Teaching states: a
 * layout-mirroring skeleton while the first reads are in flight
 * (§4.12), the ErrorState when the API is unreachable with nothing
 * known, and a quiet hint when there is no activity yet.
 */
function homePanel(state: WorkspaceState, viewAt: number): VNode {
  const fresh = homeFresh(state);
  // THE HERO'S LAUNCH AFFORDANCE (the J3 entry, Home shape): the
  // primary flow's own CTA when nothing is running; a resume hint
  // while the wizard is open (the wizard renders in the launch panel
  // directly below); a progress note while a launch is in flight or
  // has finished. Mirrors launchPanel's own states — never a dead
  // button (a launch-start while a draft is open would be refused by
  // the handler; the hero shows the honest state instead).
  const launch = state.launch;
  const draftActive = launch.draft !== null && (launch.phase === 'draft' || launch.phase === 'idle');
  const launchQuiet = launch.draft === null && launch.progress.length === 0 && launch.error === null;
  const heroCta: VNode | undefined = draftActive
    ? v('p', { class: 'hero-note', 'data-hero-launch': 'draft' }, ['The launch wizard is open — continue below.'])
    : launchQuiet
      ? v('button', { class: 'hero-cta', 'data-action': 'launch-start', type: 'button' }, ['Describe your goal'])
      : v('p', { class: 'hero-note', 'data-hero-launch': launch.phase }, ['A launch is in progress — details below.']);
  const hero = heroPanel(heroCta);
  if (state.connection === 'connecting' && fresh) {
    return v('section', { class: 'panel home', 'data-section': 'home' }, [hero, loadingState('stat-grid')]);
  }
  if (state.connection === 'offline' && fresh) {
    const latest = state.degraded.length === 0 ? undefined : state.degraded[state.degraded.length - 1];
    return v('section', { class: 'panel home', 'data-section': 'home' }, [
      hero,
      errorState('The console could not reach the API.', {
        technical: latest === undefined ? undefined : `${latest.route} — ${latest.message}`,
      }),
    ]);
  }
  const jobs = projectToView(state.jobs, viewAt, availabilityOfJob);
  const outcomes = projectToView(state.outcomes, viewAt, availabilityOfOutcome);
  const postMortems = projectToView(state.postMortems, viewAt, availabilityOfPostMortem);
  const knowledge = projectToView(state.knowledge, viewAt, availabilityOfKnowledge);
  const submissions = projectToView(state.submissions, viewAt, availabilityOfSubmission);
  const snapshots = projectToView(state.orgSnapshots, viewAt, availabilityOfOrgSnapshot);
  const capsuleCount = outcomes.length + postMortems.length + knowledge.length + submissions.length;
  const unread = unreadCount(state.inbox);
  const running = jobs.filter((job) => job.status === 'running').length;
  const snapshot = snapshots.length > 0 ? snapshots[0] : null;
  const tiles = statGrid([
    statCard({ icon: 'pulse', label: 'ACTIVE JOBS', value: String(running), delta: `${jobs.length} total` }),
    statCard({ icon: 'chart', label: 'OUTCOMES', value: String(outcomes.length) }),
    statCard({ icon: 'box', label: 'EVIDENCE CAPSULES', value: String(capsuleCount) }),
    statCard({ icon: 'inbox', label: 'UNREAD NOTICES', value: String(unread), ok: unread === 0 }),
  ]);
  const organization = richStatCard({
    eyebrow: 'ORGANIZATION',
    value: snapshot === null ? 'Not compiled yet' : snapshot.status,
    ...(snapshot === null ? {} : { qualifier: `observed ${formatTimeUtc(snapshot.at)}` }),
    sentence: 'The compiled team working your goal.',
    details: [
      ['Tenant', state.scope.tenantId],
      ['Project', state.scope.projectId],
      ['Instances', snapshot === null ? '0' : String(snapshot.instanceRefs.length)],
    ],
  });
  const notices = projectToView(state.inbox.notices, viewAt, (record) => record.at);
  const entries: TimelineEntry[] = notices.map((record) => ({
    at: record.at,
    title: record.title,
    description: `${record.source.route} ${record.source.ref}`,
    slug: record.kind,
    severity: noticeSeverityOf(record.kind),
  }));
  const buckets = timelineBucketsOf(entries, viewAt);
  const activity = buckets.length === 0
    ? v('div', { class: 'empty' }, ['No activity yet — notices from your organization appear here.'])
    : timelineList(buckets);
  return v('section', { class: 'panel home', 'data-section': 'home' }, [
    hero,
    tiles,
    organization,
    v('div', { class: 'home-block' }, [v('h2', { class: 'section-heading' }, ['Recent activity']), activity]),
  ]);
}

/** The open sheet's content (§4.5a) — resolved from the shell view against the state, gated like the rows. */
function sheetContentOf(state: WorkspaceState, viewAt: number, view: ShellView): VNode[] {
  const sheet: SheetRef | null = view.sheet;
  if (sheet === null) return [];
  if (sheet.kind === 'job') {
    const job = state.jobs.find((candidate) => candidate.jobId === sheet.id);
    if (job === undefined) return [];
    return jobSheet(state.scope, job, viewAt, renderJobProgress(state.launch.jobId === job.jobId ? state.launch.progress : []));
  }
  const snapshot = state.orgSnapshots.find((candidate) => candidate.organizationRef === sheet.id);
  if (snapshot === undefined) return [];
  return snapshotSheet(state.scope, snapshot, viewAt);
}

/** The per-section panel — the selected section's projection at the view instant. */
function sectionPanel(state: WorkspaceState, viewAt: number, view: ShellView = defaultShellView(state)): VNode {
  const scope = state.scope;
  const selector = state.selectedSection;
  if (selector === 'goal') {
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
      if (rows.length === 0) {
        // THE J3 ENTRY: with no loaded goal, the section's single
        // primary action starts the guided launch wizard — unless a
        // draft is ALREADY in progress (re-starting would wipe the
        // user's work; the wizard renders below this notice).
        const draftActive = state.launch.draft !== null && (state.launch.phase === 'draft' || state.launch.phase === 'idle');
        rows.push(draftActive
          ? v('div', { class: 'card', 'data-goal': 'launch-in-progress' }, [
              v('div', { class: 'card-title' }, ['The launch wizard is open']),
              v('p', { class: 'card-note' }, ['Describe what this organization should achieve below — the goal loads here when the launch completes.']),
            ])
          : sectionEmpty('goal'));
      }
      return v('section', { class: 'panel', 'data-section': 'goal' }, rows);
  } else if (selector === 'organization') {
      const projected = projectToView(state.orgSnapshots, viewAt, availabilityOfOrgSnapshot);
      const cards = projected.map((snapshot) => orgSnapshotCard(scope, snapshot, viewAt));
      return v('section', { class: 'panel', 'data-section': 'organization' }, [
        ...cards,
        ...(projected.length === 0 ? [sectionEmpty('organization')] : []),
      ]);
  } else if (selector === 'market-world') {
      const draft = state.launch.draft;
      if (draft === null) {
        return v('section', { class: 'panel', 'data-section': 'market-world' }, [sectionEmpty('market-world')]);
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
  } else if (selector === 'time-machine') {
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
  } else if (selector === 'research') {
      const projected = projectToView(state.jobs.filter((job) => job.kind === 'research'), viewAt, availabilityOfJob);
      const cards = projected.map((job) => jobCard(scope, job, viewAt, renderJobProgress(state.launch.jobId === job.jobId ? state.launch.progress : [])));
      return v('section', { class: 'panel', 'data-section': 'research' }, [
        ...cards,
        ...(projected.length === 0 ? [sectionEmpty('research')] : []),
      ]);
  } else if (selector === 'experiments') {
      const projected = projectToView(state.jobs, viewAt, availabilityOfJob);
      const experiments: Map<string, string> = new Map();
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
        ...(projected.length === 0 ? [sectionEmpty('experiments')] : []),
      ]);
  } else if (selector === 'decisions') {
      const submissions = projectToView(state.submissions, viewAt, availabilityOfSubmission);
      const watchFeed = projectToView(watchEventsOf(state), viewAt, (event) => event.at);
      return v('section', { class: 'panel', 'data-section': 'decisions' }, [
        v('div', { class: 'watch' }, [v('h2', {}, ['Watch']), ...watchFeed.map((event) => watchEventRow(scope, event, viewAt, view.openCapsule))]),
        ...submissions.map((submission) => v('div', { class: 'decision-block' }, [
          submissionCard(scope, submission, viewAt),
          capsuleInline(capsuleFromSubmission(scope, submission), viewAt, view.openCapsule),
        ])),
        ...(submissions.length === 0 && watchFeed.length === 0 ? [sectionEmpty('decisions')] : []),
      ]);
  } else if (selector === 'execution') {
      const submissions = projectToView(state.submissions, viewAt, availabilityOfSubmission);
      return v('section', { class: 'panel', 'data-section': 'execution' }, [
        v('p', { class: 'hint' }, ['The console submits execution REQUESTS through the API; the gateway alone decides (L8/L20).']),
        ...submissions.map((submission) => v('div', { class: 'decision-block' }, [
          submissionCard(scope, submission, viewAt),
          capsuleInline(capsuleFromSubmission(scope, submission), viewAt, view.openCapsule),
        ])),
        ...(submissions.length === 0 ? [sectionEmpty('execution')] : []),
      ]);
  } else if (selector === 'risk') {
      const rows: VNode[] = [];
      if (state.constraintSet !== null) {
        rows.push(v('div', { class: 'card' }, [
          v('div', { class: 'card-title' }, ['Constraint set']),
          ...state.constraintSet.constraints.map((constraint) => factRow(`${constraint.severity} ${constraint.id}`, `${constraint.domain}.${constraint.subject} ${constraint.predicate.kind}`)),
        ]));
      }
      const riskPolicies: Map<string, string> = new Map();
      for (const outcome of projectToView(state.outcomes, viewAt, availabilityOfOutcome)) {
        riskPolicies.set(outcome.lineage.shadow.riskPolicy.policyId, `v${outcome.lineage.shadow.riskPolicy.version}`);
      }
      rows.push(v('div', { class: 'card' }, [
        v('div', { class: 'card-title' }, ['Risk policies (outcome lineage)']),
        ...[...riskPolicies.entries()].map(([policyId, version]) => factRow(policyId, version)),
        ...(riskPolicies.size === 0 ? [factRow('risk policies', 'none at this view instant')] : []),
      ]));
      return v('section', { class: 'panel', 'data-section': 'risk' }, rows);
  } else if (selector === 'evidence') {
      const capsules: EvidenceCapsule[] = [
        ...projectToView(state.outcomes, viewAt, availabilityOfOutcome).map((outcome) => capsuleFromOutcome(scope, outcome)),
        ...projectToView(state.postMortems, viewAt, availabilityOfPostMortem).map((postMortem) => capsuleFromPostMortem(scope, postMortem)),
        ...projectToView(state.knowledge, viewAt, availabilityOfKnowledge).map((knowledge) => capsuleFromKnowledge(scope, knowledge)),
        ...projectToView(state.submissions, viewAt, availabilityOfSubmission).map((submission) => capsuleFromSubmission(scope, submission)),
      ];
      return v('section', { class: 'panel', 'data-section': 'evidence' }, [
        ...capsules.map((capsule) => capsuleCard(capsule, viewAt, view.openCapsule)),
        ...(capsules.length === 0 ? [sectionEmpty('evidence')] : []),
      ]);
  } else if (selector === 'outcomes') {
      const projected = projectToView(state.outcomes, viewAt, availabilityOfOutcome);
      const cards = projected.map((outcome) => v('div', { class: 'decision-block' }, [
        outcomeCard(scope, outcome, viewAt),
        // J7: the outcome's own evidence capsule renders INLINE (its
        // content-address badge opens the payload + provenance here).
        capsuleInline(capsuleFromOutcome(scope, outcome), viewAt, view.openCapsule),
      ]));
      return v('section', { class: 'panel', 'data-section': 'outcomes' }, [
        ...cards,
        ...(projected.length === 0 ? [sectionEmpty('outcomes')] : []),
      ]);
  } else if (selector === 'lessons') {
      const knowledgeProjected = projectToView(state.knowledge, viewAt, availabilityOfKnowledge);
      const postMortemProjected = projectToView(state.postMortems, viewAt, availabilityOfPostMortem);
      return v('section', { class: 'panel', 'data-section': 'lessons' }, [
        ...knowledgeProjected.map((knowledge) => knowledgeCard(scope, knowledge, viewAt)),
        ...postMortemProjected.map((postMortem) => postMortemCard(scope, postMortem, viewAt)),
        ...(knowledgeProjected.length + postMortemProjected.length === 0 ? [sectionEmpty('lessons')] : []),
      ]);
    }
  // The section union is closed and total above (the erasable-subset
  // if/else form cannot prove exhaustiveness to the compiler).
  throw new Error(`sectionPanel: ${JSON.stringify(selector)} is not a workspace section`);
}

/** The launch panel (the primary flow's wizard + progress). */
/** The launch wizard's next step (the primary flow's own order). */
function nextStepOf(step: LaunchStep): LaunchStep {
  const index = LAUNCH_STEPS.indexOf(step);
  return LAUNCH_STEPS[Math.min(index + 1, LAUNCH_STEPS.length - 1)] as LaunchStep;
}

/** The launch panel (the primary flow: the wizard's full field set + the review step + the two-step confirm + progress). */
function launchPanel(state: WorkspaceState, view: ShellView): VNode {
  const launch = state.launch;
  const progress = renderJobProgress(launch.progress);
  const rows: VNode[] = [];
  const draftActive = launch.draft !== null && (launch.phase === 'draft' || launch.phase === 'idle');
  if (draftActive && launch.draft !== null) {
    const draft = launch.draft;
    const armed = view.confirm === 'launch';
    const touched = view.touchedFields;
    // THE J3 WIRING: the rendered field values are the MERGED live
    // form (the draft's committed values + the app layer's pending
    // edits — core/launch-form.ts's merge), so a re-render at any
    // instant keeps what the user last typed even before the edit is
    // committed into the state machine; the per-field validation is
    // the SAME pure module the review gate and the flush use.
    const form: LaunchFormValues = launchFormValues(draft, view.launchEdits);
    const touchedOf = (field: LaunchFieldName): boolean => touched.includes(field);
    const validationOf = (field: LaunchFieldName): { message: string; touched: boolean } | undefined => touchedOf(field) ? { message: launchFieldValidation(form, field), touched: true } : undefined;
    // The review step renders the summary + the two-step confirm; every other
    // step renders its labeled fields (labels ABOVE, inline validation on blur).
    const goalFields = [
      ...labeledInput({ label: 'Name', name: 'name', value: form.name, required: true, placeholder: 'e.g. Momentum scout', validation: validationOf('name') }),
      ...labeledInput({ label: 'Objective', name: 'objective', value: form.objective, required: true, hint: 'One sentence — what this organization should achieve.', validation: validationOf('objective') }),
    ];
    const budgetFields = [
      ...labeledInput({ label: 'Capital budget', name: 'capitalBudget', value: form.capitalBudget, required: true, hint: 'An exact decimal, e.g. 10000.00.', validation: validationOf('capitalBudget') }),
      ...labeledInput({ label: 'Risk budget', name: 'riskBudget', value: form.riskBudget, required: true, hint: 'An exact decimal, e.g. 250.00.', validation: validationOf('riskBudget') }),
    ];
    const marketFields = [
      ...labeledInput({ label: 'Markets', name: 'markets', value: form.markets, required: true, hint: 'Comma-separated instrument ids.', validation: validationOf('markets') }),
      ...labeledInput({ label: 'Venues', name: 'venues', value: form.venues, required: true, hint: 'Comma-separated venue ids.', validation: validationOf('venues') }),
      ...labeledInput({ label: 'Data sources', name: 'dataSources', value: form.dataSources, required: true, hint: 'Comma-separated data source refs.', validation: validationOf('dataSources') }),
    ];
    const worldFields = [
      ...labeledInput({ label: 'Horizon starts', name: 'horizonStartsAt', value: form.horizonStartsAt, type: 'number', required: true, hint: 'Epoch ms.', validation: validationOf('horizonStartsAt') }),
      ...labeledInput({ label: 'Horizon ends', name: 'horizonEndsAt', value: form.horizonEndsAt, type: 'number', required: true, hint: 'Epoch ms.', validation: validationOf('horizonEndsAt') }),
      ...labeledSelect({ label: 'Execution mode', name: 'executionMode', value: form.executionMode, required: true, hint: 'Simulation is the safe default — live execution goes through the gateway.', choices: EXECUTION_MODES.map((mode) => [mode, mode] as const), validation: validationOf('executionMode') }),
      ...labeledInput({ label: 'Preferences', name: 'preferences', value: form.preferences, hint: 'Optional key=value pairs.', validation: validationOf('preferences') }),
      ...labeledInput({ label: 'Constraints', name: 'constraints', value: form.constraints, hint: `Optional executable limits, e.g. ${constraintGrammarExample()}.`, validation: validationOf('constraints') }),
    ];
    const fieldsByStep: Record<string, readonly VNode[]> = { goal: goalFields, budget: budgetFields, markets: marketFields, world: worldFields };
    const stepFields = fieldsByStep[launch.step] ?? [];
    // THE REVIEW GATE: the review step renders the summary + the
    // two-step confirm ONLY when the merged form passes every field
    // validation; otherwise the problems render (every field treated
    // as touched — the review is the gate before any launch, §4.11)
    // and the arm button stays away until they are fixed.
    const problems = launchDraftProblems(form);
    const reviewValid = problems.length === 0;
    rows.push(v('div', { class: 'card launch-wizard', 'data-launch-step': launch.step }, [
      v('div', { class: 'card-title' }, [`Primary flow — ${launch.step}`]),
      v('div', { class: 'segmented tm-modes' }, LAUNCH_STEPS.map((step) => v('button', {
        class: `segment${launch.step === step ? ' active' : ''}`,
        'data-action': `launch-step-${step}`,
        type: 'button',
        'aria-pressed': launch.step === step ? 'true' : 'false',
      }, [step]))),
      ...(launch.step === 'review'
        ? [
          reviewStep([
            ['Name', form.name],
            ['Objective', form.objective],
            ['Capital budget', form.capitalBudget],
            ['Risk budget', form.riskBudget],
            ['Markets', form.markets],
            ['Venues', form.venues],
            ['Data sources', form.dataSources],
            ['Horizon', `${form.horizonStartsAt} -> ${form.horizonEndsAt}`],
            ['Execution mode', form.executionMode],
            ['Preferences', form.preferences.length === 0 ? 'none' : form.preferences],
            ['Constraints', form.constraints.length === 0 ? 'none' : form.constraints],
            ['Success criteria', draft.successCriteria.map((criterion) => `${criterion.id}: ${criterion.metric} ${criterion.predicate.kind}`).join('; ')],
          ]),
          ...(reviewValid
            ? [twoStepConfirm('launch', armed)]
            : [v('div', { class: 'review-problems', role: 'alert', 'data-review-problems': String(problems.length) }, [
                v('div', { class: 'def-eyebrow' }, ['FIX BEFORE LAUNCHING']),
                ...problems.map(([field, message]) => v('p', { class: 'field-error', 'data-problem-field': field }, [message])),
                v('p', { class: 'field-hint' }, ['Fix each field on its step, then return here to launch.']),
              ])]),
        ]
        : [...stepFields, v('div', { class: 'tm-playback' }, [
          v('button', { class: 'tm-button', 'data-action': `launch-step-${nextStepOf(launch.step)}`, type: 'button' }, [`Next: ${nextStepOf(launch.step)}`]),
          v('button', { class: 'tm-button', 'data-action': 'launch-step-review', type: 'button' }, ['Review']),
        ])]),
    ]));
  }
  if (launch.draft !== null && !draftActive) {
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
    rows.push(v('div', { class: 'card', 'data-launch-phase': progress.phase }, [
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
  if (launch.error !== null) {
    rows.push(v('div', { class: 'card error-card' }, [
      v('div', { class: 'card-title' }, ['Launch failed']),
      factRow('error', launch.error),
      v('button', { class: 'tm-button', 'data-action': 'launch-reset', type: 'button' }, ['Start over']),
    ]));
  }
  if (rows.length === 0) {
    // THE J3 ENTRY's second affordance: the launch panel renders
    // below every section — its idle state carries the primary flow's
    // START action wherever the user is.
    rows.push(v('div', { class: 'empty', 'data-launch-idle': 'true' }, [
      v('span', {}, ['No launch in progress.']),
      v('button', { class: 'tm-button', 'data-action': 'launch-start', type: 'button' }, ['Start the primary flow']),
    ]));
  }
  return v('section', { class: 'panel launch', 'data-section': 'launch' }, rows);
}

/** The onboarding wizard's single render lives in renderAppShell (§4.13 — the modal overlay); this model never renders it (the W-10b double-render fix). */

/**
 * THE WHOLE-CONSOLE RENDER MODEL: one pure pass at an injected
 * instant. The wall-clock guard is armed for the entire pass; every
 * record passes its availability gate and its scope gate; every
 * verdict renders the gateway's own. Determinism: identical
 * (state, at, view, paletteResults) -> identical serializeVNode bytes.
 *
 * The T051 shell (render/shell.ts) wraps the panels: the sidebar's
 * grouped navigation, the CONNECTION block and the per-section page
 * scaffold (H1 + subtitle + status badge + actions) are CHROME — the
 * section panels and every law gate inside them are T042 law,
 * unchanged. The optional shell view carries only chrome state
 * (theme, the account landing target, endpoint, simulated flag,
 * busy/drawer/sheet/palette/onboarding/toast states); the default
 * view reproduces the classic section render. The palette results
 * are injected data (the app layer owns the live query).
 *
 * THE ONBOARDING LAW (the W-10b fix): the wizard renders EXACTLY
 * ONCE — the §4.13 fixed-position modal overlay in renderAppShell,
 * directly under the shell root. This model renders the main
 * content NORMALLY behind it (the T051 defect rendered a second,
 * in-place copy of the wizard instead of the main content — two
 * stacked overlays, both frozen at step one; the a11y tree read the
 * wizard twice).
 */
export function renderConsoleModel(state: WorkspaceState, at: number, view: ShellView = defaultShellView(state), paletteResults: readonly import('../core/palette').PaletteEntry[] = []): VNode {
  return withRenderGuard(() => {
    const viewAt = viewAtOf(state);
    const activeTarget = activeTargetOf(state, view);
    const main: VNode = activeTarget === 'home'
      ? homePanel(state, viewAt)
      : activeTarget === 'inbox'
        ? inboxPanel(state, viewAt)
        : activeTarget === 'settings'
          ? settingsPanel(state, view)
          : sectionPanel(state, viewAt, view);
    const launch = activeTarget === 'inbox' || activeTarget === 'settings' ? null : launchPanel(state, view);
    return renderAppShell(state, at, view, activeTarget, {
      timeMachine: timeMachineBar(state, viewAt),
      main,
      launch,
      sheet: sheetContentOf(state, viewAt, view),
      paletteResults,
    });
  });
}

/** Serialize the whole-console model (the render determinism pin). */
export function serializeConsoleModel(state: WorkspaceState, at: number): string {
  return serializeVNode(renderConsoleModel(state, at));
}
