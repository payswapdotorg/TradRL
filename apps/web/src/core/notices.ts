// @tradrl/web-console — notifications (UX.md, verbatim): the eight
// event types as typed notice records consumed from the API's read
// surface, with an inbox + unread state.
//
// THE LAW (Work Order T042): "Notifications (UX.md): the eight event
// types (organization compiled; training milestone; failed
// evaluation; capability gap; release candidate; acceptance criteria
// met; shadow degradation; safety intervention) as typed notice
// records consumed from the API's read surface, with an inbox +
// unread state."
//
// The boundary (T041) serves no dedicated notification route; the
// read surface it DOES serve carries a signal for each event type.
// The fold below is the deterministic derivation map — every entry
// names the read it folds from:
//
//   organization compiled   <- an org-status snapshot reaching
//                              'active' (the compiled organization
//                              operating) — organizations.status.
//   training milestone      <- a learning job reaching 'complete' —
//                              jobs reads.
//   failed evaluation       <- a job reaching 'failed' — jobs reads.
//   capability gap          <- a served knowledge entry whose status
//                              is 'decayed' (a capability the firm
//                              memory no longer stands behind) —
//                              knowledge reads.
//   release candidate       <- a research job reaching 'complete'
//                              whose job-machinery result marker is
//                              { kind: 'release-candidate' } — jobs
//                              reads (the spec's semantics belong to
//                              the job machinery; the console folds
//                              only the marker).
//   acceptance criteria met <- the project's lifecycle reaching
//                              'completed' — projects reads.
//   shadow degradation      <- a shadow-lineage outcome whose
//                              deviation fell outside tolerance —
//                              outcomes reads.
//   safety intervention     <- the execution gateway REFUSING an
//                              intent (the hard safety gate, L20) —
//                              execution reads.
//
// The fold is PURE and idempotent: the same reads fold to identical
// notice bytes (determinism tests pin it), re-folding adds nothing,
// and a notice from another tenant is the typed CrossTenantRenderError.
//
// Spec anchors: R36 (project-centric UX), L4 (notices carry the
// availability instant of the read they fold from), L12, L20.

import type {
  GatewaySubmissionRecord,
  JobRecord,
  OrgStatusSnapshot,
  OutcomeRecord,
  ProjectRecord,
  ServedKnowledge,
} from '../api/contracts';
import { digestOf } from './digest';
import { CrossTenantRenderError } from './errors';
import { assertProjectScope, tenantOfRecord, type WorkspaceScope } from './tenant';
import { availabilityOfJob, availabilityOfKnowledge, availabilityOfOrgSnapshot, availabilityOfOutcome, availabilityOfProject, availabilityOfSubmission } from './availability';

/** The eight UX.md notification event types, in charter order. */
export const NOTICE_KINDS = [
  'organization_compiled',
  'training_milestone',
  'failed_evaluation',
  'capability_gap',
  'release_candidate',
  'acceptance_criteria_met',
  'shadow_degradation',
  'safety_intervention',
] as const;

/** One notification event type. */
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** Guard: a notice kind. */
export function isNoticeKind(v: unknown): v is NoticeKind {
  return typeof v === 'string' && (NOTICE_KINDS as readonly string[]).includes(v);
}

/** One typed fact rendered inside a notice (closed vocabulary labels; decimal values verbatim). */
export interface NoticeFact {
  readonly label: string;
  readonly value: string;
}

/** One typed notice record. */
export interface NoticeRecord {
  /** Content-addressed id: 'ntc:' + digest of the derivation — same signal, same id (idempotent fold). */
  readonly noticeId: string;
  readonly kind: NoticeKind;
  readonly tenantId: string;
  readonly projectId: string;
  /** The availability instant (L4): the read instant the notice folds from. */
  readonly at: number;
  /** The API read the notice was folded from (the route + the record ref — provenance, R45). */
  readonly source: { readonly route: string; readonly ref: string };
  /** The closed-vocabulary title (per kind — the UX charter's own names). */
  readonly title: string;
  /** The typed facts (labels from the per-kind table; values verbatim). */
  readonly facts: readonly NoticeFact[];
}

/** The closed title table (UX.md's own event names). */
export const NOTICE_TITLES: Readonly<Record<NoticeKind, string>> = Object.freeze({
  organization_compiled: 'Organization compiled',
  training_milestone: 'Training milestone',
  failed_evaluation: 'Failed evaluation',
  capability_gap: 'Capability gap',
  release_candidate: 'Release candidate',
  acceptance_criteria_met: 'Acceptance criteria met',
  shadow_degradation: 'Shadow degradation',
  safety_intervention: 'Safety intervention',
});

/** The per-kind fact labels (closed vocabulary). */
export const NOTICE_FACT_LABELS: Readonly<Record<NoticeKind, readonly string[]>> = Object.freeze({
  organization_compiled: ['organization', 'status', 'instances'],
  training_milestone: ['job', 'kind'],
  failed_evaluation: ['job', 'kind'],
  capability_gap: ['knowledge', 'claim-kind', 'confidence'],
  release_candidate: ['job', 'kind'],
  acceptance_criteria_met: ['project', 'status'],
  shadow_degradation: ['outcome', 'outcome-class', 'realized-gap'],
  safety_intervention: ['submission', 'stage'],
});

/** The reads the notice fold consumes (each entry the API's own read surface). */
export interface NoticeReads {
  /** The latest project record (projects reads). */
  readonly project?: ProjectRecord;
  /** The org-status snapshot history, oldest first (organizations.status reads). */
  readonly orgSnapshots?: readonly OrgStatusSnapshot[];
  /** The tracked job records (jobs reads). */
  readonly jobs?: readonly JobRecord[];
  /** The served knowledge page (knowledge reads). */
  readonly knowledge?: readonly ServedKnowledge[];
  /** The outcome records (outcomes reads). */
  readonly outcomes?: readonly OutcomeRecord[];
  /** The execution submissions (execution reads). */
  readonly submissions?: readonly GatewaySubmissionRecord[];
}

/** Build one notice (pure; the id is content-addressed over the derivation). */
function notice(scope: WorkspaceScope, kind: NoticeKind, at: number, source: { readonly route: string; readonly ref: string }, facts: readonly NoticeFact[]): NoticeRecord {
  const identity = { kind, tenantId: scope.tenantId, projectId: scope.projectId, source, at };
  return {
    noticeId: `ntc:${digestOf(identity)}`,
    kind,
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    at,
    source,
    title: NOTICE_TITLES[kind],
    facts,
  };
}

/**
 * THE NOTICE FOLD: derive every notice the reads' signals carry, for
 * one workspace scope. Pure, deterministic and idempotent: the same
 * reads (and scope) fold to identical notice bytes, in a total order
 * (by at, then noticeId). A record from another tenant is the typed
 * CrossTenantRenderError — cross-tenant notices never fold.
 */
export function foldNotices(scope: WorkspaceScope, reads: NoticeReads): readonly NoticeRecord[] {
  const notices: NoticeRecord[] = [];

  const project = reads.project;
  if (project !== undefined) {
    assertProjectScope(scope, project);
    if (project.lifecycle.status === 'completed') {
      notices.push(notice(scope, 'acceptance_criteria_met', availabilityOfProject(project), { route: '/v1/projects/:id', ref: project.id }, [
        { label: 'project', value: project.id },
        { label: 'status', value: project.lifecycle.status },
      ]));
    }
  }

  for (const snapshot of reads.orgSnapshots ?? []) {
    assertProjectScope(scope, snapshot);
    // The compiled signal: the organization operating (status 'active') —
    // the first active snapshot, or the transition into it.
    if (snapshot.status === 'active') {
      notices.push(notice(scope, 'organization_compiled', availabilityOfOrgSnapshot(snapshot), { route: '/v1/organizations/:ref/status', ref: snapshot.organizationRef }, [
        { label: 'organization', value: snapshot.organizationRef },
        { label: 'status', value: snapshot.status },
        { label: 'instances', value: String(snapshot.instanceRefs.length) },
      ]));
    }
  }

  for (const job of reads.jobs ?? []) {
    assertProjectScope(scope, job);
    if (job.status === 'complete' && job.kind === 'learning') {
      notices.push(notice(scope, 'training_milestone', availabilityOfJob(job), { route: '/v1/jobs/:id', ref: job.jobId }, [
        { label: 'job', value: job.jobId },
        { label: 'kind', value: job.kind },
      ]));
    }
    if (job.status === 'failed') {
      notices.push(notice(scope, 'failed_evaluation', availabilityOfJob(job), { route: '/v1/jobs/:id', ref: job.jobId }, [
        { label: 'job', value: job.jobId },
        { label: 'kind', value: job.kind },
      ]));
    }
    if (job.status === 'complete' && job.kind === 'research' && isReleaseCandidateResult(job.result)) {
      notices.push(notice(scope, 'release_candidate', availabilityOfJob(job), { route: '/v1/jobs/:id', ref: job.jobId }, [
        { label: 'job', value: job.jobId },
        { label: 'kind', value: job.kind },
      ]));
    }
  }

  for (const knowledge of reads.knowledge ?? []) {
    assertProjectScope(scope, knowledge.record);
    if (knowledge.status === 'decayed') {
      notices.push(notice(scope, 'capability_gap', availabilityOfKnowledge(knowledge), { route: '/v1/knowledge/query', ref: knowledge.record.knowledgeId }, [
        { label: 'knowledge', value: knowledge.record.knowledgeId },
        { label: 'claim-kind', value: knowledge.record.claim.kind },
        { label: 'confidence', value: knowledge.record.confidence },
      ]));
    }
  }

  for (const outcome of reads.outcomes ?? []) {
    assertProjectScope(scope, outcome);
    if (outcome.lineage.shadow.fidelity.mode === 'shadow' && outcome.deviation.withinTolerance === false) {
      notices.push(notice(scope, 'shadow_degradation', availabilityOfOutcome(outcome), { route: '/v1/outcomes/query', ref: outcome.outcomeId }, [
        { label: 'outcome', value: outcome.outcomeId },
        { label: 'outcome-class', value: outcome.outcomeClass },
        { label: 'realized-gap', value: outcome.deviation.realizedGap ?? 'unknown' },
      ]));
    }
  }

  for (const submission of reads.submissions ?? []) {
    if (submission.kind === 'refused') {
      notices.push(notice(scope, 'safety_intervention', availabilityOfSubmission(submission), { route: '/v1/execution/requests', ref: submission.submissionId }, [
        { label: 'submission', value: submission.submissionId },
        { label: 'stage', value: submission.refusal.stage },
      ]));
    }
  }

  // The total deterministic order: by availability instant, then id.
  const ordered = notices.sort((a, b) => (a.at === b.at ? (a.noticeId < b.noticeId ? -1 : 1) : a.at - b.at));
  return Object.freeze(ordered);
}

/** The job-machinery release-candidate result marker (the ONLY result shape the fold interprets — documented, narrow). */
function isReleaseCandidateResult(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const candidate = result as Record<string, unknown>;
  return candidate.kind === 'release-candidate';
}

/** The inbox state: the folded notices plus the read set (unread = folded minus read). */
export interface InboxState {
  readonly notices: readonly NoticeRecord[];
  readonly readNoticeIds: readonly string[];
}

/** The empty inbox. */
export function emptyInbox(): InboxState {
  return { notices: [], readNoticeIds: [] };
}

/** The unread notices of an inbox (in the fold's deterministic order). */
export function unreadNotices(inbox: InboxState): readonly NoticeRecord[] {
  const read = new Set(inbox.readNoticeIds);
  return inbox.notices.filter((record) => !read.has(record.noticeId));
}

/** The unread count of an inbox. */
export function unreadCount(inbox: InboxState): number {
  return unreadNotices(inbox).length;
}

/**
 * Merge newly folded notices into an inbox: idempotent by noticeId
 * (content-addressed — the same signal never doubles), the read set
 * preserved (a re-fold never marks read notices unread).
 */
export function mergeNotices(inbox: InboxState, folded: readonly NoticeRecord[]): InboxState {
  const known = new Set(inbox.notices.map((record) => record.noticeId));
  const fresh = folded.filter((record) => !known.has(record.noticeId));
  if (fresh.length === 0) return inbox;
  const merged = [...inbox.notices, ...fresh].sort((a, b) => (a.at === b.at ? (a.noticeId < b.noticeId ? -1 : 1) : a.at - b.at));
  return { notices: Object.freeze(merged), readNoticeIds: inbox.readNoticeIds };
}

/** Mark one notice read (idempotent; the read set stays sorted for byte-determinism). */
export function markNoticeRead(inbox: InboxState, noticeId: string): InboxState {
  if (inbox.readNoticeIds.includes(noticeId)) return inbox;
  return { notices: inbox.notices, readNoticeIds: Object.freeze([...inbox.readNoticeIds, noticeId].sort()) };
}

/** Mark every folded notice read (idempotent). */
export function markAllNoticesRead(inbox: InboxState): InboxState {
  return { notices: inbox.notices, readNoticeIds: Object.freeze(inbox.notices.map((record) => record.noticeId)) };
}

/** Guard used by the fold's tests: every record in the reads belongs to the scope (else the typed cross-tenant error fires inside the fold). */
export function assertReadsScoped(scope: WorkspaceScope, reads: NoticeReads): void {
  if (reads.project !== undefined) {
    if (tenantOfRecord(reads.project) !== scope.tenantId) {
      throw new CrossTenantRenderError(`a project record of tenant ${JSON.stringify(tenantOfRecord(reads.project))} entered the notice fold of ${JSON.stringify(scope.tenantId)}`, scope.tenantId, tenantOfRecord(reads.project));
    }
  }
}
