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
// identical states (serializeWorkspace pins it).
//
// THE CHAIN (R9a — export integrity, real since chain format v2):
// every history entry retains the EXACT EVENT it was linked from
// (`payload`), and the chain is a real SHA-256 hash chain over
// canonical JSON — the published rules (also embedded verbatim in
// every export, so anyone holding the file can recompute every
// digest and every link, and any single-field tamper breaks
// verification):
//
//   digest    = sha256Hex(canonicalJson({ seq, tenantId, projectId,
//                 payload }))            — the entry's chained record
//   chainHead = sha256Hex(priorChainHead + digest)
//                                   — fixed-width 64-hex concatenation
//   genesis   = 64 zero hex chars (the head before the first entry)
//
// (Chain format v1 — the pre-R9a form — linked 8-hex FNV-1a digests
// of events it did not retain, so its exports could never be
// re-derived; v2 keeps nothing from it. The state is ephemeral —
// rebuilt from API reads each boot — so no runtime migration was
// needed; pre-fix EXPORTS simply do not verify and the verifier says
// so. Export composition REBUILDS the chain over the exported
// payloads, so every export produced after this fix verifies
// end-to-end regardless of runtime history format.)
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
  ProjectGoalWorldSpec,
  ProjectRecord,
  ServedKnowledge,
} from '../api/contracts';
import { DEFAULT_SECTION, isSectionId, type SectionId } from './sections';
import { assertProjectScope, isWorkspaceScope, type WorkspaceScope } from './tenant';
import { canonicalJson, sha256Hex, sha256Of } from './digest';
import {
  capsuleFromKnowledge,
  capsuleFromOutcome,
  capsuleFromPostMortem,
  capsuleFromSubmission,
  capsulesFromJobs,
  type EvidenceCapsule,
} from './evidence';
import {
  advanceAnchor,
  backToLive,
  liveTimeMachine,
  pausePlayback,
  resumePlayback,
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
  unreadNotices,
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
  /** The injected instant the event was applied at (a mirror of payload.at — verifyWorkspaceChain checks the two agree). */
  readonly at: number;
  readonly kind: string;
  readonly tenantId: string;
  readonly projectId: string;
  /** THE EXACT EVENT AS APPLIED — the chain's digest input (retained since chain format v2; this is what makes every digest derivable). */
  readonly payload: WorkspaceEvent;
  /** The SHA-256 content digest of the entry's chained record {seq, tenantId, projectId, payload} (canonical JSON, lowercase 64-hex). */
  readonly digest: string;
  /** The chain head after linking this entry (64 zero hex chars before the first). */
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
  /**
   * THE PROJECT'S PERSISTED LAUNCH WORLD (D-8, W-28): the market world the
   * scope's project launched with, read back from the host goal route's
   * ADDITIVE `world` field (the backing persists it from the kickoff job's
   * spec into the goal-set record's payload). Null when the project
   * genuinely has no world on record (the demo scope — its seeded goal
   * carries no world fields; a pre-W-28 launch) — the Market World
   * section's teaching empty state is CORRECT for exactly those cases.
   */
  readonly world: ProjectGoalWorldSpec | null;
  readonly launch: LaunchState;
  readonly orgSnapshots: readonly OrgStatusSnapshot[];
  readonly jobs: readonly JobRecord[];
  readonly outcomes: readonly OutcomeRecord[];
  readonly postMortems: readonly PostMortemRecord[];
  readonly knowledge: readonly ServedKnowledge[];
  readonly submissions: readonly GatewaySubmissionRecord[];
  /** The tenant's project directory (R6c, W-22): every project the credential can read — the scope switcher's list. Cross-project by design (the workspace stays ONE project's world; this is the directory you may switch that world to). */
  readonly projectDirectory: readonly ProjectRecord[];
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
    world: null,
    launch: initialLaunchState(),
    orgSnapshots: [],
    jobs: [],
    outcomes: [],
    postMortems: [],
    knowledge: [],
    submissions: [],
    projectDirectory: [],
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
  | { readonly kind: 'goal-loaded'; readonly at: number; readonly goal: GoalStatement; readonly constraintSet: ConstraintSetStatement; /** The scope's persisted launch world, when the host goal route served one (D-8, W-28) — absent = the project has none on record. */ readonly world?: ProjectGoalWorldSpec }
  | { readonly kind: 'org-snapshot'; readonly at: number; readonly snapshot: OrgStatusSnapshot }
  | { readonly kind: 'job-updated'; readonly at: number; readonly job: JobRecord }
  | { readonly kind: 'outcomes-loaded'; readonly at: number; readonly records: readonly OutcomeRecord[] }
  | { readonly kind: 'post-mortems-loaded'; readonly at: number; readonly records: readonly PostMortemRecord[] }
  | { readonly kind: 'knowledge-loaded'; readonly at: number; readonly records: readonly ServedKnowledge[] }
  | { readonly kind: 'submission-recorded'; readonly at: number; readonly submission: GatewaySubmissionRecord }
  | { readonly kind: 'projects-listed'; readonly at: number; readonly records: readonly ProjectRecord[] }
  | { readonly kind: 'section-selected'; readonly at: number; readonly section: SectionId }
  | { readonly kind: 'view-live'; readonly at: number }
  | { readonly kind: 'view-tminus'; readonly at: number; readonly tMinusMs: number }
  | { readonly kind: 'view-timestamp'; readonly at: number; readonly timestamp: number }
  | { readonly kind: 'anchor-advanced'; readonly at: number }
  | { readonly kind: 'playback-start'; readonly at: number; readonly fromAt: number; readonly stepMs: number }
  | { readonly kind: 'playback-tick'; readonly at: number }
  | { readonly kind: 'playback-paused'; readonly at: number }
  | { readonly kind: 'playback-resumed'; readonly at: number }
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

// ---------------------------------------------------------------------------
// THE CHAIN FORMAT (v2 — R9a). Published constants: every export carries
// them verbatim, and the verifier enforces them, so anyone can recompute.
// ---------------------------------------------------------------------------

/** The chain's hash algorithm: SHA-256 (FIPS 180-4), over canonical JSON, as lowercase 64-hex. */
export const CHAIN_ALGORITHM = 'sha-256';

/** The chain format version: 2 (v1 was the pre-R9a 8-hex FNV-1a form — decorative, never derivable). */
export const CHAIN_FORMAT_VERSION = 2;

/** THE DOCUMENTED GENESIS: the chain head standing before the first entry (64 zero hex chars — the v2 format width). */
export const CHAIN_GENESIS = '0'.repeat(64);

/** The published digest rule, embedded verbatim in every export. */
export const CHAIN_DIGEST_RULE = 'digest = sha256Hex(canonicalJson({seq,tenantId,projectId,payload})) as lowercase 64-hex; canonicalJson recursively sorts object keys (apps/web/src/core/digest.ts)';

/** The published link rule, embedded verbatim in every export. */
export const CHAIN_LINK_RULE = 'chainHead = sha256Hex(previousChainHead + digest) as lowercase 64-hex; plain concatenation of two fixed-width 64-hex strings; the genesis previousChainHead is 64 zero hex chars';

/** The 64-hex shape of every v2 digest and chain head. */
const HEX_64 = /^[0-9a-f]{64}$/;

/** The digest of one chain entry's record (the published digest rule, in code). */
function chainDigestOf(seq: number, tenantId: string, projectId: string, payload: unknown): string {
  return sha256Of({ seq, tenantId, projectId, payload });
}

/** Link one digest onto the prior head (the published link rule, in code). */
function chainLinkOf(priorHead: string, digest: string): string {
  return sha256Hex(priorHead + digest);
}

/** Link one event onto the history chain (pure). */
function linkHistory(state: WorkspaceState, event: WorkspaceEvent): readonly HistoryEntry[] {
  const prior = state.history.length === 0 ? null : (state.history[state.history.length - 1] as HistoryEntry);
  const seq = state.history.length + 1;
  const digest = chainDigestOf(seq, state.scope.tenantId, state.scope.projectId, event);
  const entry: HistoryEntry = {
    seq,
    at: event.at,
    kind: event.kind,
    tenantId: state.scope.tenantId,
    projectId: state.scope.projectId,
    payload: event,
    digest,
    chainHead: chainLinkOf(prior === null ? CHAIN_GENESIS : prior.chainHead, digest),
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
      // The launch flow's bridge: the workspace ADOPTS the created
      // project's id. From the launchpad scope (no project yet — the
      // shipped shell's default) this is the first adoption; from a
      // PROJECT-SCOPED boot (the deployed shell: TRADRL_CONSOLE_PROJECT_ID
      // scopes it to the seeded demo project, which the boot read cadence
      // loads) the launch SUPERSEDES the prior project — the console is
      // project-centric (R36) and the workspace is ONE project's world
      // (L12), so the prior project's records leave the sections and the
      // created project's world becomes the workspace's (the history
      // chain keeps everything, append-only; the session's folded notices
      // stay — they happened). Every record ingested after the adoption
      // must carry the adopted project (the gate enforces it); the prior
      // project's records are foreign from here on (a re-ingest is the
      // typed cross-scope error).
      if (event.projectId.length === 0) throw new Error('reduceWorkspace: project-adopted requires the created project id');
      if (state.project !== null && state.project.id === event.projectId) {
        // Re-adopting the project the workspace already carries: an
        // idempotent no-op (no record churn, no double transition).
        return withHistory;
      }
      const superseded: WorkspaceState = {
        ...withHistory,
        project: null,
        goal: null,
        constraintSet: null,
        world: null,
        orgSnapshots: [],
        jobs: [],
        outcomes: [],
        postMortems: [],
        knowledge: [],
        submissions: [],
      };
      return { ...superseded, scope: { tenantId: state.scope.tenantId, projectId: event.projectId } };
  } else if (selector === 'project-loaded') {
      assertProjectScope(state.scope, event.project);
      const next: WorkspaceState = { ...withHistory, project: event.project };
      return { ...next, inbox: refoldNotices(next) };
  } else if (selector === 'goal-loaded') {
      if (event.goal.tenantId !== state.scope.tenantId) {
        // The goal statement carries its own tenant id (the T007 shape): a foreign goal never enters the workspace.
        assertProjectScope(state.scope, event.goal);
      }
      // D-8 (W-28): the goal bundle's ADDITIVE world field mirrors the
      // scope's OWN persisted launch world — a read that serves no `world`
      // (the demo scope, a pre-W-28 launch) CLEARS any prior one, exactly
      // like goal/constraintSet: the state always mirrors THIS scope's
      // read-back truth, never a stale world from a prior scope.
      return { ...withHistory, goal: event.goal, constraintSet: event.constraintSet, world: event.world ?? null };
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
  } else if (selector === 'projects-listed') {
      // THE PROJECT DIRECTORY (R6c, W-22): the tenant's readable
      // projects, replaced wholesale per read (the boundary's own
      // ordering). NO scope assert: the directory spans projects by
      // design — it is the switcher's list, never the workspace's
      // records (a switch goes through project-adopted, which resets
      // every record first).
      return { ...withHistory, projectDirectory: Object.freeze([...event.records]) };
  } else if (selector === 'section-selected') {
      if (!isSectionId(event.section)) throw new Error(`reduceWorkspace: ${JSON.stringify(event.section)} is not a workspace section`);
      return { ...withHistory, selectedSection: event.section };
  } else if (selector === 'view-live') {
      return { ...withHistory, timeMachine: backToLive(advanceAnchor(withHistory.timeMachine, event.at)) };

  } else if (selector === 'view-tminus') {
      return { ...withHistory, timeMachine: setTMinus(advanceAnchor(withHistory.timeMachine, event.at), event.tMinusMs) };

  } else if (selector === 'view-timestamp') {
      return { ...withHistory, timeMachine: setTimestamp(advanceAnchor(withHistory.timeMachine, event.at), event.timestamp) };

  } else if (selector === 'anchor-advanced') {
      // THE LIVE ANCHOR'S OWN TRANSITION (the W-17a fix — the v0.1.0
      // J03 release blocker): the app observed a fresh live instant (the
      // beat cadence / the launch seam) and the anchor follows it —
      // exactly what advanceAnchor exists for ("the app observes a fresh
      // injected instant"). Before this event the anchor only moved on
      // the user's Time Machine clicks, so a LIVE session's view instant
      // stayed pinned at the BOOT instant forever: every datum that
      // became available after boot (the just-created project, the
      // kickoff job) was post-view-time and the L4 projection refused it
      // — every launch on the deployed origin ended "Launch (failed)"
      // with the typed AvailabilityViolationError. The anchor is the
      // ceiling for every view: in live mode the view IS the anchor (the
      // world as of NOW); a T-x offset rides the fresh anchor ("x before
      // now" stays true as now advances); playback's ceiling rises with
      // it (a tick still never passes the anchor — the pure machine's
      // typed law, unchanged). The app layer dispatches this only with an
      // observed instant BEYOND the current anchor (the anchor never
      // regresses).
      return { ...withHistory, timeMachine: advanceAnchor(withHistory.timeMachine, event.at) };

  } else if (selector === 'playback-start') {
      return { ...withHistory, timeMachine: startPlayback(advanceAnchor(withHistory.timeMachine, event.at), event.fromAt, event.stepMs) };

  } else if (selector === 'playback-tick') {
      return { ...withHistory, timeMachine: tickPlayback(advanceAnchor(withHistory.timeMachine, event.at)) };

  } else if (selector === 'playback-paused') {
      // THE PAUSE (R10, W-25C): the playback control's second face —
      // the view instant FREEZES (tickPlayback stops advancing it; the
      // anchor keeps following the observed now, the view does not).
      // Before this event the pause control re-dispatched
      // playback-start, which RE-ARMED playback at the opened instant
      // with zero ticks: the view jumped BACK to openedAt (the J5
      // symptom: "pause jumps the view back ~5.5s") and the beat kept
      // ticking it forward from there ("playback keeps advancing").
      return { ...withHistory, timeMachine: pausePlayback(advanceAnchor(withHistory.timeMachine, event.at)) };

  } else if (selector === 'playback-resumed') {
      // The resume: continue from the FROZEN instant — fromAt/ticks
      // untouched, so the next tick steps from exactly where pause
      // left the view (no jump-back, no re-arm).
      return { ...withHistory, timeMachine: resumePlayback(advanceAnchor(withHistory.timeMachine, event.at)) };

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
 * Verify the history chain (chain format v2): every entry's digest
 * RECOMPUTES from its retained payload, every chain head links under
 * the published rules, the envelope mirrors the payload, and the seq
 * is contiguous. Pure; the first broken entry is named. The chain is
 * tamper-evident end to end: altering any entry's payload (any field
 * of the applied event), digest, chain head, seq, scope fields or
 * envelope breaks verification at that entry or the first entry after
 * it. A pre-v2 entry (an 8-hex digest, or no retained payload) fails
 * loudly — the old form was never derivable and is never accepted.
 */
export function verifyWorkspaceChain(history: readonly HistoryEntry[]): { readonly ok: true } | { readonly ok: false; readonly firstBrokenSeq: number; readonly reason: string } {
  let priorHead = CHAIN_GENESIS;
  for (let index = 0; index < history.length; index++) {
    const entry = history[index] as HistoryEntry;
    if (entry.seq !== index + 1) {
      return { ok: false, firstBrokenSeq: entry.seq, reason: `entry ${index + 1} carries seq ${JSON.stringify(entry.seq)}` };
    }
    if (typeof entry.digest !== 'string' || !HEX_64.test(entry.digest)) {
      return { ok: false, firstBrokenSeq: entry.seq, reason: `entry ${entry.seq}'s digest is not a 64-hex SHA-256 digest (chain format v2)` };
    }
    if (typeof entry.chainHead !== 'string' || !HEX_64.test(entry.chainHead)) {
      return { ok: false, firstBrokenSeq: entry.seq, reason: `entry ${entry.seq}'s chain head is not 64-hex (chain format v2)` };
    }
    if (typeof entry.payload !== 'object' || entry.payload === null) {
      return { ok: false, firstBrokenSeq: entry.seq, reason: `entry ${entry.seq} retains no payload — its digest cannot be recomputed (chain format v1 was never derivable)` };
    }
    const digest = chainDigestOf(entry.seq, entry.tenantId, entry.projectId, entry.payload);
    if (digest !== entry.digest) {
      return { ok: false, firstBrokenSeq: entry.seq, reason: `entry ${entry.seq}'s digest does not match its chained record (seq, scope, payload)` };
    }
    const payload = entry.payload as { readonly kind?: unknown; readonly at?: unknown };
    if (payload.kind !== entry.kind || payload.at !== entry.at) {
      return { ok: false, firstBrokenSeq: entry.seq, reason: `entry ${entry.seq}'s kind/at envelope does not match its payload` };
    }
    const head = chainLinkOf(priorHead, entry.digest);
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

// ---------------------------------------------------------------------------
// THE WORKSPACE EXPORT (R9b — "download everything" completeness)
// ---------------------------------------------------------------------------
//
// The export document is SELF-DESCRIBING: a manifest of what is
// included, the full chain-format descriptor (the published rules,
// verbatim), the rebuilt SHA-256 event chain (every event's payload
// retained — derivable end to end), and the collections the pre-fix
// export OMITTED: the evidence capsules, the decision records and
// the inbox read-state. The composition is PURE and deterministic:
// identical states compose byte-identical documents.
//
// THE HANDOFF SEAM: the app layer's export action (Settings →
// "Export workspace data") serializes exactly these bytes —
// serializeWorkspaceExport(state) — so anyone holding the downloaded
// file can verify it with verifyWorkspaceExport(JSON.parse(bytes)).

/** The export document's format identity. */
export const EXPORT_FORMAT = 'tradrl-workspace-export';
/** The export document's format version: 2 (v1 was the bare serializeWorkspace dump — the R9 findings). */
export const EXPORT_FORMAT_VERSION = 2;

/** The chain descriptor every export carries (the published algorithm, verbatim). */
export interface ExportChainDescriptor {
  readonly algorithm: string;
  readonly version: number;
  readonly genesis: string;
  readonly digestRule: string;
  readonly linkRule: string;
  readonly entryCount: number;
  readonly head: string;
}

/** One chain entry inside an export: the event's full record plus its digest and link (nothing else). */
export interface ExportChainEntry {
  readonly seq: number;
  readonly tenantId: string;
  readonly projectId: string;
  /** The exact event as applied (the digest's input — the derivability guarantee). */
  readonly payload: WorkspaceEvent;
  readonly digest: string;
  readonly chainHead: string;
}

/** The workspace state as exported (everything but the history — the history IS the events chain). */
export type ExportedWorkspaceState = Omit<WorkspaceState, 'history'>;

/** The manifest of what an export includes (self-describing completeness). */
export interface ExportManifest {
  readonly included: readonly string[];
  readonly counts: Record<string, number>;
}

/** THE EXPORT DOCUMENT — everything the console knows about the workspace. */
export interface WorkspaceExportDocument {
  readonly format: string;
  readonly formatVersion: number;
  readonly scope: WorkspaceScope;
  readonly chain: ExportChainDescriptor;
  readonly manifest: ExportManifest;
  readonly workspace: ExportedWorkspaceState;
  readonly events: readonly ExportChainEntry[];
  readonly capsules: readonly EvidenceCapsule[];
  readonly decisions: {
    /** The seven-lens decision records, exactly as the Decisions section renders them. */
    readonly watch: readonly WatchEvent[];
    /** The execution gateway's own routed/refused records (L20 — verbatim, never re-decided). */
    readonly gateway: readonly GatewaySubmissionRecord[];
  };
  readonly readState: {
    readonly readNoticeIds: readonly string[];
    readonly unreadNoticeIds: readonly string[];
  };
}

/**
 * Compose the workspace export (pure, deterministic). The chain is
 * REBUILT over the exact exported events under the published v2
 * rules — so every export verifies end-to-end regardless of the
 * runtime history's format (after this change they agree by
 * construction; the rebuild is the structural guarantee). An entry
 * that lacks its payload is a loud error, never a fake digest.
 */
export function composeWorkspaceExport(state: WorkspaceState): WorkspaceExportDocument {
  const events: ExportChainEntry[] = [];
  let priorHead = CHAIN_GENESIS;
  for (const entry of state.history) {
    if (typeof entry.payload !== 'object' || entry.payload === null) {
      throw new Error(`composeWorkspaceExport: history entry ${entry.seq} retains no payload — the chain cannot be rebuilt honestly`);
    }
    const digest = chainDigestOf(entry.seq, entry.tenantId, entry.projectId, entry.payload);
    const chainHead = chainLinkOf(priorHead, digest);
    events.push({ seq: entry.seq, tenantId: entry.tenantId, projectId: entry.projectId, payload: entry.payload, digest, chainHead });
    priorHead = chainHead;
  }

  // R9b: the evidence capsules — the same content-addressed bundles
  // the Evidence section renders (one per outcome, post-mortem,
  // served-knowledge entry and execution submission), in the
  // section's order. Since W-28 (D-9) also one per COMPLETED job WITH a
  // result (the result->job lineage leg — the export's capsules
  // collection is the audit pack; a research result that mints no
  // capsule is a lineage leaf, exactly what L2's P19 recompute found).
  // Unprojected: the export is the complete record, and every capsule
  // carries its own availability instant (L4).
  const capsules: EvidenceCapsule[] = [
    ...state.outcomes.map((outcome) => capsuleFromOutcome(state.scope, outcome)),
    ...state.postMortems.map((postMortem) => capsuleFromPostMortem(state.scope, postMortem)),
    ...state.knowledge.map((knowledge) => capsuleFromKnowledge(state.scope, knowledge)),
    ...state.submissions.map((submission) => capsuleFromSubmission(state.scope, submission)),
    ...capsulesFromJobs(state.scope, state.jobs),
  ];

  // R9b: the decisions — the seven-lens watch records (agent,
  // capability, evidence, proposal, challenge, risk checks, decision)
  // plus the gateway's own submission records, exactly as the
  // Decisions section renders them.
  const decisions = {
    watch: watchEventsOf(state),
    gateway: [...state.submissions],
  };

  // R9b: the read-state — which notices the user has read (the
  // pre-fix export lost this; the inbox's own fold is inside
  // `workspace`, and this block makes the read/unread split
  // first-class and greppable).
  const readNoticeIds = [...state.inbox.readNoticeIds];
  const unreadNoticeIds = unreadNotices(state.inbox).map((notice) => notice.noticeId);

  // (the runtime history stays with the state; the export's `events`
  // block IS the history, rebuilt as the v2 chain)
  const { history: _retainedHistory, ...workspaceWithoutHistory } = state;

  const manifest: ExportManifest = {
    included: [
      'workspace.state',
      'events.chain',
      'evidence.capsules',
      'decisions.watch',
      'decisions.gateway',
      'readState',
    ],
    counts: {
      events: events.length,
      capsules: capsules.length,
      decisionsWatch: decisions.watch.length,
      decisionsGateway: decisions.gateway.length,
      notices: state.inbox.notices.length,
      readNotices: readNoticeIds.length,
      unreadNotices: unreadNoticeIds.length,
    },
  };

  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    scope: state.scope,
    chain: {
      algorithm: CHAIN_ALGORITHM,
      version: CHAIN_FORMAT_VERSION,
      genesis: CHAIN_GENESIS,
      digestRule: CHAIN_DIGEST_RULE,
      linkRule: CHAIN_LINK_RULE,
      entryCount: events.length,
      head: priorHead,
    },
    manifest,
    workspace: workspaceWithoutHistory,
    events,
    capsules,
    decisions,
    readState: { readNoticeIds, unreadNoticeIds },
  };
}

/** The exported document's bytes (canonical JSON — the determinism pin applies to the export too). */
export function serializeWorkspaceExport(state: WorkspaceState): string {
  return canonicalJson(composeWorkspaceExport(state));
}

/**
 * Verify an exported document's chain end to end from the file alone:
 * the format and chain descriptors must carry the published v2
 * algorithm and genesis, every event's digest must recompute from its
 * own retained payload under the published digest rule, every link
 * must recompute from the prior head, the seq must be contiguous,
 * every entry must belong to the exporting tenant, and the
 * descriptor's counts and head must match the events. Pure — anyone
 * with the file and the published rules can run exactly this.
 */
export function verifyWorkspaceExport(doc: unknown): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { ok: false, reason: 'the export is not a JSON object' };
  }
  const record = doc as Record<string, unknown>;
  if (record.format !== EXPORT_FORMAT) {
    return { ok: false, reason: `the document's format is ${JSON.stringify(record.format)} (expected ${JSON.stringify(EXPORT_FORMAT)})` };
  }
  if (record.formatVersion !== EXPORT_FORMAT_VERSION) {
    return { ok: false, reason: `the document's format version is ${JSON.stringify(record.formatVersion)} (expected ${EXPORT_FORMAT_VERSION})` };
  }
  const chain = record.chain;
  if (typeof chain !== 'object' || chain === null) {
    return { ok: false, reason: 'the export carries no chain descriptor' };
  }
  const chainRecord = chain as Record<string, unknown>;
  if (chainRecord.algorithm !== CHAIN_ALGORITHM) {
    return { ok: false, reason: `the chain's algorithm is ${JSON.stringify(chainRecord.algorithm)} (expected ${JSON.stringify(CHAIN_ALGORITHM)})` };
  }
  if (chainRecord.version !== CHAIN_FORMAT_VERSION) {
    return { ok: false, reason: `the chain's format version is ${JSON.stringify(chainRecord.version)} (expected ${CHAIN_FORMAT_VERSION})` };
  }
  if (chainRecord.genesis !== CHAIN_GENESIS) {
    return { ok: false, reason: 'the chain declares a foreign genesis' };
  }
  const scope = record.scope;
  if (typeof scope !== 'object' || scope === null) {
    return { ok: false, reason: 'the export carries no scope' };
  }
  const scopeRecord = scope as Record<string, unknown>;
  if (typeof scopeRecord.tenantId !== 'string') {
    return { ok: false, reason: 'the export scope carries no tenant id' };
  }
  const events = record.events;
  if (!Array.isArray(events)) {
    return { ok: false, reason: 'the export carries no events array' };
  }
  let priorHead = CHAIN_GENESIS;
  for (let index = 0; index < events.length; index++) {
    const entry = events[index];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, reason: `event ${index + 1} is not a JSON object` };
    }
    const eventRecord = entry as Record<string, unknown>;
    if (eventRecord.seq !== index + 1) {
      return { ok: false, reason: `event ${index + 1} carries seq ${JSON.stringify(eventRecord.seq)}` };
    }
    // The tenant is one per workspace (adoptions change the project,
    // never the tenant) — a foreign-tenant entry is a broken export.
    if (eventRecord.tenantId !== scopeRecord.tenantId) {
      return { ok: false, reason: `event ${index + 1} does not belong to the export's tenant` };
    }
    if (typeof eventRecord.digest !== 'string' || !HEX_64.test(eventRecord.digest)) {
      return { ok: false, reason: `event ${index + 1}'s digest is not a 64-hex SHA-256 digest (chain format v2)` };
    }
    if (typeof eventRecord.chainHead !== 'string' || !HEX_64.test(eventRecord.chainHead)) {
      return { ok: false, reason: `event ${index + 1}'s chain head is not 64-hex (chain format v2)` };
    }
    const digest = sha256Of({ seq: eventRecord.seq, tenantId: eventRecord.tenantId, projectId: eventRecord.projectId, payload: eventRecord.payload });
    if (digest !== eventRecord.digest) {
      return { ok: false, reason: `event ${index + 1}'s digest does not match its chained record (seq, scope, payload)` };
    }
    const head = sha256Hex(priorHead + (eventRecord.digest as string));
    if (head !== eventRecord.chainHead) {
      return { ok: false, reason: `event ${index + 1}'s chain head does not link to event ${index}` };
    }
    priorHead = eventRecord.chainHead;
  }
  if (chainRecord.entryCount !== events.length) {
    return { ok: false, reason: `the chain counts ${JSON.stringify(chainRecord.entryCount)} events but the export carries ${events.length}` };
  }
  if (chainRecord.head !== priorHead) {
    return { ok: false, reason: 'the chain head does not match the last event' };
  }
  return { ok: true };
}
