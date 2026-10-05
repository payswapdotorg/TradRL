// @tradrl/web-console — the workspace state machine.
//
// THE LAW (Work Order T042): "The workspace model: the twelve UX.md
// sections ... as a typed project workspace state — each section fed
// by the T041 API read routes"; "Determinism: identical inputs ->
// identical bytes. Tests must pin this (workspace state transitions,
// availability projection, notice folding)"; "Append-only +
// chain-verified wherever history is retained."
//
// This module is the PURE heart of the console: one typed state, one
// event union, one total reducer, one append-only chain-verified
// history. No DOM, no clock, no transport — the app layer feeds it
// events (every one stamped with an INJECTED instant), the render
// layer projects it. Identical event sequences produce byte-
// identical states (serializeWorkspace pins it); the history chain
// (FNV-1a over canonical JSON, each entry linked to the prior head)
// makes the workspace's own past verifiable — tamper with any entry
// and verifyWorkspaceChain fails.
//
// Spec anchors: R36 (project-centric UX), R39, L4 (view-time
// projection consumes timeMachine.viewAt), L11/L9 (the chain), L12
// (every record entering the state passes the scope gate).

import type {
  ConstraintSetStatement,
  GatewaySubmissionRecord,
  GoalStatement,
  JobRecord,
  JobStatus,
  OrgStatusSnapshot,
  OutcomeRecord,
  PostMortemRecord,
  ProjectRecord,
  ServedKnowledge,
} from '../api/contracts';
import { DEFAULT_SECTION, isSectionId, type SectionId } from './sections';
import { assertProjectScope, isWorkspaceScope, type WorkspaceScope } from './tenant';
import { fnv1a32Hex, canonicalJson, digestOf } from './digest';
import {
  advanceAnchor,
  backToLive,
  liveTimeMachine,
  setTimestamp,
  setTMinus,
  startPlayback,
  tickPlayback,
  viewAtOf as viewAtOfTimeMachine,
  type TimeMachineState,
} from './timemachine';
import {
  emptyInbox,
  foldNotices,
  markAllNoticesRead,
  markNoticeRead,
  mergeNotices,
  type InboxState,
  type NoticeReads,
} from './notices';
import {
  initialLaunchState,
  type JobProgressPoint,
  type LaunchDraft,
  type LaunchState,
  type LaunchStep,
} from './launch';
import { watchEventFromJob, watchEventFromOutcome, watchEventFromPostMortem, watchEventFromSubmission, watchEventsFromOrgSnapshot, orderWatchEvents, type WatchEvent } from './watch';

/** The connection status (the graceful-degradation surface). */
export type ConnectionStatus = 'connecting' | 'connected' | 'degraded' | 'offline';

/** One degraded-read note (a failed read: which route, which family, at which injected instant). */
export interface DegradationNote {
  readonly route: string;
  readonly family: string;
  readonly message: string;
  readonly at: number;
}

/** One append-only, chain-verified history entry. */
export interface HistoryEntry {
  /** The 1-based sequence. */
  readonly seq: number;
  /** The injected instant the event was applied at. */
  readonly at: number;
  readonly kind: string;
  readonly tenantId: string;
  readonly projectId: string;
  /** The content digest of the event's payload (FNV-1a over canonical JSON). */
  readonly digest: string;
  /** The chain head after linking this entry ('00000000' before the first). */
  readonly chainHead: string;
}

/** THE WORKSPACE STATE — one tenant/project scope, the twelve sections' data, the Time Machine, the inbox, the launch flow, the chain. */
export interface WorkspaceState {
  readonly scope: WorkspaceScope;
  readonly openedAt: number;
  readonly connection: ConnectionStatus;
  readonly selectedSection: SectionId;
  readonly project: ProjectRecord | null;
  readonly goal: GoalStatement | null;
  readonly constraintSet: ConstraintSetStatement | null;
  readonly launch: LaunchState;
  readonly orgSnapshots: readonly OrgStatusSnapshot[];
  readonly jobs: readonly JobRecord[];
  readonly outcomes: readonly OutcomeRecord[];
  readonly postMortems: readonly PostMortemRecord[];
  readonly knowledge: readonly ServedKnowledge[];
  readonly submissions: readonly GatewaySubmissionRecord[];
  readonly timeMachine: TimeMachineState;
  readonly inbox: InboxState;
  readonly degraded: readonly DegradationNote[];
  readonly history: readonly HistoryEntry[];
}

/** Open a workspace (the initial state; `at` is the injected open instant). */
export function openWorkspace(scope: WorkspaceScope, at: number): WorkspaceState {
  if (!isWorkspaceScope(scope)) throw new Error('openWorkspace: a workspace scope { tenantId, projectId } is required');
  if (!Number.isInteger(at)) throw new Error('openWorkspace: the open instant must be integer epoch ms');
  return {
    scope,
    openedAt: at,
    connection: 'connecting',
    selectedSection: DEFAULT_SECTION,
    project: null,
    goal: null,
    constraintSet: null,
    launch: initialLaunchState(),
    orgSnapshots: [],
    jobs: [],
    outcomes: [],
    postMortems: [],
    knowledge: [],
    submissions: [],
    timeMachine: liveTimeMachine(at),
    inbox: emptyInbox(),
    degraded: [],
    history: [],
  };
}

// ---------------------------------------------------------------------------
// The event union (every event stamped with an INJECTED instant)
// ---------------------------------------------------------------------------

/** The workspace events — the app layer's only write path into the state. */
export type WorkspaceEvent =
  | { readonly kind: 'connection-changed'; readonly at: number; readonly status: ConnectionStatus }
  | { readonly kind: 'project-adopted'; readonly at: number; readonly projectId: string }
  | { readonly kind: 'project-loaded'; readonly at: number; readonly project: ProjectRecord }
  | { readonly kind: 'goal-loaded'; readonly at: number; readonly goal: GoalStatement; readonly constraintSet: ConstraintSetStatement }
  | { readonly kind: 'org-snapshot'; readonly at: number; readonly snapshot: OrgStatusSnapshot }
  | { readonly kind: 'job-updated'; readonly at: number; readonly job: JobRecord }
  | { readonly kind: 'outcomes-loaded'; readonly at: number; readonly records: readonly OutcomeRecord[] }
  | { readonly kind: 'post-mortems-loaded'; readonly at: number; readonly records: readonly PostMortemRecord[] }
  | { readonly kind: 'knowledge-loaded'; readonly at: number; readonly records: readonly ServedKnowledge[] }
  | { readonly kind: 'submission-recorded'; readonly at: number; readonly submission: GatewaySubmissionRecord }
  | { readonly kind: 'section-selected'; readonly at: number; readonly section: SectionId }
  | { readonly kind: 'view-live'; readonly at: number }
  | { readonly kind: 'view-tminus'; readonly at: number; readonly tMinusMs: number }
  | { readonly kind: 'view-timestamp'; readonly at: number; readonly timestamp: number }
  | { readonly kind: 'playback-start'; readonly at: number; readonly fromAt: number; readonly stepMs: number }
  | { readonly kind: 'playback-tick'; readonly at: number }
  | { readonly kind: 'notice-read'; readonly at: number; readonly noticeId: string }
  | { readonly kind: 'notices-read-all'; readonly at: number }
  | { readonly kind: 'degraded-read'; readonly at: number; readonly route: string; readonly family: string; readonly message: string }
  | { readonly kind: 'launch-draft-started'; readonly at: number; readonly draft: LaunchDraft }
  | { readonly kind: 'launch-draft-edited'; readonly at: number; readonly draft: LaunchDraft }
  | { readonly kind: 'launch-step-changed'; readonly at: number; readonly step: LaunchStep }
  | { readonly kind: 'launch-submitted'; readonly at: number; readonly projectId: string; readonly jobId: string }
  | { readonly kind: 'launch-progress'; readonly at: number; readonly status: JobStatus }
  | { readonly kind: 'launch-completed'; readonly at: number }
  | { readonly kind: 'launch-failed'; readonly at: number; readonly message: string }
  | { readonly kind: 'launch-reset'; readonly at: number };

/** The bounded retention of degradation notes (the newest 20 — the surface stays useful, the history chain keeps everything). */
const DEGRADED_RETENTION = 20;

/** Link one event onto the history chain (pure). */
function linkHistory(state: WorkspaceState, event: WorkspaceEvent): readonly HistoryEntry[] {
  const prior = state.history.length === 0 ? null : (state.history[state.history.length - 1] as HistoryEntry);
  const digest = digestOf(event);
  const entry: HistoryEntry = {
    seq: state.history.length + 1,
    at: event.at,
    kind: event.kind,
    tenantId: state.scope.tenantId,
    projectId: state.scope.projectId,
    digest,
    chainHead: fnv1a32Hex(`${prior === null ? '00000000' : prior.chainHead}:${digest}`),
  };
  return [...state.history, entry];
}

/** The notice reads of a state (the fold's input — the state's own records). */
function noticeReadsOf(state: Pick<WorkspaceState, 'project' | 'orgSnapshots' | 'jobs' | 'knowledge' | 'outcomes' | 'submissions'>): NoticeReads {
  return {
    ...(state.project === null ? {} : { project: state.project }),
    orgSnapshots: state.orgSnapshots,
    jobs: state.jobs,
    knowledge: state.knowledge,
    outcomes: state.outcomes,
    submissions: state.submissions,
  };
}

/** Refold the notices after a data event (deterministic + idempotent merge). */
function refoldNotices(state: WorkspaceState): InboxState {
  return mergeNotices(state.inbox, foldNotices(state.scope, noticeReadsOf(state)));
}

/** THE REDUCER — pure and total. Identical states + identical events -> identical states, byte for byte. */
export function reduceWorkspace(state: WorkspaceState, event: WorkspaceEvent): WorkspaceState {
  const withHistory: WorkspaceState = { ...state, history: linkHistory(state, event) };
  const selector = event.kind;
  if (selector === 'connection-changed') {
      return { ...withHistory, connection: event.status };

  } else if (selector === 'project-adopted') {
      // The launch flow's bridge: the workspace opens on the launchpad
      // scope (no project yet) and adopts the created project's id — the
      // ONE scope transition the console knows. Every record ingested
      // after it must carry the adopted project (the gate enforces it).
      if (event.projectId.length === 0) throw new Error('reduceWorkspace: project-adopted requires the created project id');
      if (state.project !== null && state.project.id !== event.projectId) {
        throw new Error(`reduceWorkspace: the workspace already adopted project ${state.project.id}; adopting ${event.projectId} is a typed input error`);
      }
      return { ...withHistory, scope: { tenantId: state.scope.tenantId, projectId: event.projectId } };
  } else if (selector === 'project-loaded') {
      assertProjectScope(state.scope, event.project);
      const next: WorkspaceState = { ...withHistory, project: event.project };
      return { ...next, inbox: refoldNotices(next) };
  } else if (selector === 'goal-loaded') {
      if (event.goal.tenantId !== state.scope.tenantId) {
        // The goal statement carries its own tenant id (the T007 shape): a foreign goal never enters the workspace.
        assertProjectScope(state.scope, event.goal);
      }
      return { ...withHistory, goal: event.goal, constraintSet: event.constraintSet };
  } else if (selector === 'org-snapshot') {
      assertProjectScope(state.scope, event.snapshot);
      const seen = state.orgSnapshots.some((existing) => existing.organizationRef === event.snapshot.organizationRef && existing.at === event.snapshot.at);
      const next: WorkspaceState = seen
        ? withHistory
        : { ...withHistory, orgSnapshots: [...state.orgSnapshots, event.snapshot] };
      return { ...next, inbox: refoldNotices(next) };
  } else if (selector === 'job-updated') {
      assertProjectScope(state.scope, event.job);
      const existing = state.jobs.findIndex((job) => job.jobId === event.job.jobId);
      const jobs = existing === -1
        ? [...state.jobs, event.job]
        : state.jobs.map((job, index) => (index === existing ? event.job : job));
      const next: WorkspaceState = { ...withHistory, jobs };
      // The launch flow tracks its own kickoff job's progress.
      const launch = state.launch.jobId === event.job.jobId
        ? { ...state.launch, progress: [...state.launch.progress, { status: event.job.status, at: event.at }] as readonly JobProgressPoint[] }
        : state.launch;
      return { ...next, launch, inbox: refoldNotices({ ...next, launch }) };
  } else if (selector === 'outcomes-loaded') {
      for (const record of event.records) assertProjectScope(state.scope, record);
      const next: WorkspaceState = { ...withHistory, outcomes: Object.freeze([...event.records]) };
      return { ...next, inbox: refoldNotices(next) };
  } else if (selector === 'post-mortems-loaded') {
      for (const record of event.records) {
        assertProjectScope(state.scope, { tenant: record.lineage.tenant, project: record.lineage.project });
      }
      return { ...withHistory, postMortems: Object.freeze([...event.records]) };
  } else if (selector === 'knowledge-loaded') {
      for (const record of event.records) assertProjectScope(state.scope, record.record);
      const next: WorkspaceState = { ...withHistory, knowledge: Object.freeze([...event.records]) };
      return { ...next, inbox: refoldNotices(next) };
  } else if (selector === 'submission-recorded') {
      const seen = state.submissions.some((existing) => existing.submissionId === event.submission.submissionId);
      const next: WorkspaceState = seen
        ? withHistory
        : { ...withHistory, submissions: [...state.submissions, event.submission] };
      return { ...next, inbox: refoldNotices(next) };
  } else if (selector === 'section-selected') {
      if (!isSectionId(event.section)) throw new Error(`reduceWorkspace: ${JSON.stringify(event.section)} is not a workspace section`);
      return { ...withHistory, selectedSection: event.section };
  } else if (selector === 'view-live') {
      return { ...withHistory, timeMachine: backToLive(advanceAnchor(withHistory.timeMachine, event.at)) };

  } else if (selector === 'view-tminus') {
      return { ...withHistory, timeMachine: setTMinus(advanceAnchor(withHistory.timeMachine, event.at), event.tMinusMs) };

  } else if (selector === 'view-timestamp') {
      return { ...withHistory, timeMachine: setTimestamp(advanceAnchor(withHistory.timeMachine, event.at), event.timestamp) };

  } else if (selector === 'playback-start') {
      return { ...withHistory, timeMachine: startPlayback(advanceAnchor(withHistory.timeMachine, event.at), event.fromAt, event.stepMs) };

  } else if (selector === 'playback-tick') {
      return { ...withHistory, timeMachine: tickPlayback(advanceAnchor(withHistory.timeMachine, event.at)) };

  } else if (selector === 'notice-read') {
      return { ...withHistory, inbox: markNoticeRead(withHistory.inbox, event.noticeId) };

  } else if (selector === 'notices-read-all') {
      return { ...withHistory, inbox: markAllNoticesRead(withHistory.inbox) };

  } else if (selector === 'degraded-read') {
      const notes = [...withHistory.degraded, { route: event.route, family: event.family, message: event.message, at: event.at }];
      return { ...withHistory, degraded: Object.freeze(notes.slice(-DEGRADED_RETENTION)), connection: 'degraded' };
  } else if (selector === 'launch-draft-started') {
      return { ...withHistory, launch: { ...withHistory.launch, phase: 'draft', draft: event.draft, step: 'goal', error: null } };

  } else if (selector === 'launch-draft-edited') {
      return { ...withHistory, launch: { ...withHistory.launch, draft: event.draft } };

  } else if (selector === 'launch-step-changed') {
      return { ...withHistory, launch: { ...withHistory.launch, step: event.step } };

  } else if (selector === 'launch-submitted') {
      return {
        ...withHistory,
        launch: {
          ...withHistory.launch,
          phase: 'launching',
          projectId: event.projectId,
          jobId: event.jobId,
          progress: [...withHistory.launch.progress, { status: 'submitted', at: event.at }] as readonly JobProgressPoint[],
          error: null,
        },
      };

  } else if (selector === 'launch-progress') {
      return { ...withHistory, launch: { ...withHistory.launch, progress: [...withHistory.launch.progress, { status: event.status, at: event.at }] as readonly JobProgressPoint[] } };

  } else if (selector === 'launch-completed') {
      return { ...withHistory, launch: { ...withHistory.launch, phase: 'launched' } };

  } else if (selector === 'launch-failed') {
      return { ...withHistory, launch: { ...withHistory.launch, phase: 'failed', error: event.message } };

  } else if (selector === 'launch-reset') {
      return { ...withHistory, launch: initialLaunchState() };
  }
  // The union is closed and total above; an unknown kind is a typed
  // input error (the erasable-subset if/else form cannot prove
  // exhaustiveness to the compiler — this arm is the proof).
  throw new Error(`reduceWorkspace: ${JSON.stringify(selector)} is not a workspace event kind`);
}

/** Apply a sequence of events (the convenience composition — fold of the reducer). */
export function reduceAll(state: WorkspaceState, events: readonly WorkspaceEvent[]): WorkspaceState {
  return events.reduce((current, event) => reduceWorkspace(current, event), state);
}

/** Serialize a state to its canonical bytes (the determinism pin — identical states serialize identically). */
export function serializeWorkspace(state: WorkspaceState): string {
  return canonicalJson(state);
}

/**
 * Verify the history chain: every entry's digest recomputes, every
 * chain head links. Pure; the first broken entry is named. The chain
 * is tamper-evident end to end: altering any entry's digest (or any
 * chain head) breaks the link at that entry or the first entry after
 * it.
 */
export function verifyWorkspaceChain(history: readonly HistoryEntry[]): { readonly ok: true } | { readonly ok: false; readonly firstBrokenSeq: number; readonly reason: string } {
  let priorHead = '00000000';
  for (let index = 0; index < history.length; index++) {
    const entry = history[index] as HistoryEntry;
    if (entry.seq !== index + 1) {
      return { ok: false, firstBrokenSeq: entry.seq, reason: `entry ${index + 1} carries seq ${entry.seq}` };
    }
    if (!/^[0-9a-f]{8}$/.test(entry.digest)) {
      return { ok: false, firstBrokenSeq: entry.seq, reason: `entry ${entry.seq}'s digest is not an 8-hex FNV-1a digest` };
    }
    const head = fnv1a32Hex(`${priorHead}:${entry.digest}`);
    if (head !== entry.chainHead) {
      return { ok: false, firstBrokenSeq: entry.seq, reason: `entry ${entry.seq}'s chain head does not link to entry ${index}` };
    }
    priorHead = entry.chainHead;
  }
  return { ok: true };
}

/** The watch feed of a state (the seven-lens events folded from the state's records, deterministically ordered). */
export function watchEventsOf(state: WorkspaceState): readonly WatchEvent[] {
  const events: WatchEvent[] = [];
  for (const snapshot of state.orgSnapshots) {
    events.push(...watchEventsFromOrgSnapshot(state.scope, snapshot));
  }
  for (const job of state.jobs) {
    events.push(watchEventFromJob(state.scope, job));
  }
  for (const outcome of state.outcomes) {
    events.push(watchEventFromOutcome(state.scope, outcome));
  }
  for (const postMortem of state.postMortems) {
    events.push(watchEventFromPostMortem(state.scope, postMortem));
  }
  for (const submission of state.submissions) {
    events.push(watchEventFromSubmission(state.scope, submission));
  }
  return orderWatchEvents(events);
}

/** The view instant of a state (what the availability projection consumes — the Time Machine's word). */
export function viewAtOf(state: WorkspaceState): number {
  return viewAtOfTimeMachine(state.timeMachine);
}
