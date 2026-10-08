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

import type { CriterionPredicate, GatewayRefusal, GatewaySubmissionRecord, JobRecord, OrgStatusSnapshot, OutcomeRecord, PostMortemRecord, ServedKnowledge } from '../api/contracts';
import { withRenderGuard } from '../core/clock';
import { assertVisible, availabilityOfJob, availabilityOfKnowledge, availabilityOfOrgSnapshot, availabilityOfOutcome, availabilityOfPostMortem, availabilityOfProject, availabilityOfSubmission, projectToView } from '../core/availability';
import { assertProjectScope, isLaunchpadScope, type WorkspaceScope } from '../core/tenant';
import { renderDecimal } from '../core/decimals';
import { formatDurationMs, formatInstantUtc } from '../core/format';
import { PolicyEnforcementError } from '../core/errors';
import { elapsedMsOfJobRecord, initialLaunchState, renderJobProgress, LAUNCH_STEPS, researchFormValuesOf, type LaunchState, type LaunchStep } from '../core/launch';
import { formatNumberGrouped } from './numbers';
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
import { scopedInbox, unreadCount, type InboxState } from '../core/notices';
import { capsuleFromKnowledge, capsuleFromOutcome, capsuleFromPostMortem, capsuleFromSubmission, capsulesFromJobs, type EvidenceCapsule } from '../core/evidence';
import { viewAtOf, watchEventsOf, historyFloorOf, type WorkspaceState } from '../core/workspace';
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
  statusPill,
  timelineList,
  type ComponentIcon,
  type DefinitionSection,
  type PillTone,
} from './components';
import {
  capsuleBadge,
  capsulePayload,
  capsuleSurface,
  labeledInput,
  labeledSelect,
  noticeCopyOf,
  notificationBell,
  NOTICE_SENTENCES,
  refLabelOf,
  reviewStep,
  riskCheckToneOf,
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

/**
 * THE PREDICATE PHRASE (§4.5, the R5 fix — W-19): one criterion or
 * constraint predicate rendered WITH its bound(s) — "equals
 * 25,000,000", "limit.max 0.2", "limit.range 0.1 to 0.5" — straight
 * from the record's own predicate, formatted deterministically.
 * The sections used to render the bare kind ("outcome.capital.budget
 * equals" — the number existed in the record and never reached the
 * pixel); a limit without a number is not a limit (M5). Numeric
 * bounds group thousands via render/numbers.ts (locale-free,
 * byte-deterministic); string/boolean values render verbatim.
 */
export function predicatePhraseOf(predicate: CriterionPredicate): string {
  if (predicate.kind === 'limit.max' || predicate.kind === 'limit.min') {
    return `${predicate.kind} ${formatNumberGrouped(predicate.bound)}`;
  }
  if (predicate.kind === 'limit.range') {
    return `${predicate.kind} ${formatNumberGrouped(predicate.min)} to ${formatNumberGrouped(predicate.max)}`;
  }
  if (predicate.kind === 'equals' || predicate.kind === 'notEquals') {
    return `${predicate.kind} ${typeof predicate.value === 'number' ? formatNumberGrouped(predicate.value) : String(predicate.value)}`;
  }
  if (predicate.kind === 'oneOf') {
    return `${predicate.kind} ${predicate.values.join(', ')}`;
  }
  return `${predicate.kind} expected ${String(predicate.expected)}`; // flag
}

// ---------------------------------------------------------------------------
// The job RESULT projection (§4.5a, the R1 fix — W-19)
// ---------------------------------------------------------------------------

/** The readable label of a result payload kind (closed vocabulary; an unknown kind renders verbatim). */
const RESULT_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'release-candidate': 'release candidate',
  'training-summary': 'training summary',
});

/** The one-sentence summary of a known result kind (the product's own notice copy — never fabricated data). */
const RESULT_KIND_SENTENCES: Readonly<Record<string, string>> = Object.freeze({
  'release-candidate': NOTICE_SENTENCES.release_candidate,
  'training-summary': NOTICE_SENTENCES.training_milestone,
});

/** The known result fields' render order (closed labels; every OTHER field still renders under its own key). */
const RESULT_FIELD_LABELS: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'specId', label: 'spec id' },
  { key: 'version', label: 'version' },
  { key: 'epochs', label: 'epochs' },
  { key: 'title', label: 'title' },
  { key: 'summary', label: 'summary' },
  { key: 'project', label: 'project' },
];

/** Render one result payload value readably (scalars verbatim — numbers grouped; nested structures as JSON). */
function resultValueOf(value: unknown): string {
  if (value === null) return 'none';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return formatNumberGrouped(value);
  if (typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * THE RESULT PROJECTION (§4.5a, the R1 fix — W-19): the completed
 * job's OWN result payload as a readable RESULT section — the
 * researcher's deliverable, in the dialog. Null when the job record
 * carries no result payload (a submitted/running/failed job renders
 * nothing — the console never fabricates a deliverable). Every pair
 * is a field the payload ACTUALLY carries, verbatim (L20): the demo
 * machinery's research completion is { kind: 'release-candidate',
 * specId, version, project } and every one of those renders; a
 * richer payload (title, summary, findings, metrics) renders those
 * too — the projection is total over whatever the job machinery
 * served. Availability rides the job record's own gate (the result
 * arrives WITH completedAt; jobSheet's visibleAt covers it — L4).
 */
/**
 * The promotion gate's payload shape (FW-32-A): a job result record
 * narrowed to its kind-bearing form. NAMED at module scope — an inline
 * object-literal annotation on the ternary breaks the no-build stripper
 * (its brace-pairing pairs the annotation's `{` with a later cast's
 * `}`, swallowing the ternary's else arm — the boot-path law).
 */
type JobResultPayload = { readonly kind?: unknown };

/** Narrow a job record's result to the kind-bearing payload (null when absent). */
function jobResultPayloadOf(job: JobRecord): JobResultPayload | null {
  if (typeof job.result !== 'object' || job.result === null) return null;
  return job.result as JobResultPayload;
}

export function jobResultSectionOf(job: JobRecord): DefinitionSection | null {
  const result = job.result;
  if (typeof result !== 'object' || result === null) return null;
  const payload = result as Record<string, unknown>;
  const entries = Object.entries(payload);
  if (entries.length === 0) return null;
  const kind = typeof payload.kind === 'string' ? payload.kind : '';
  const pairs: (readonly [string, string])[] = [];
  if (kind.length > 0) pairs.push(['deliverable', RESULT_KIND_LABELS[kind] ?? kind]);
  const sentence = RESULT_KIND_SENTENCES[kind];
  if (sentence !== undefined) pairs.push(['summary', sentence]);
  for (const field of RESULT_FIELD_LABELS) {
    if (payload[field.key] !== undefined) pairs.push([field.label, resultValueOf(payload[field.key])]);
  }
  // The erasable-subset law: constructor type arguments are not in the
  // published subset — the annotation carries the typing.
  const known: Set<string> = new Set(['kind', ...RESULT_FIELD_LABELS.map((field) => field.key)]);
  for (const [key, value] of entries) {
    if (known.has(key)) continue;
    pairs.push([key, resultValueOf(value)]);
  }
  return { eyebrow: 'RESULT', pairs };
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

/** Render one submission's card (verdict from the record; the gate proves faithfulness). THE W-22 SUBSTANCE PASS (R2): the blotter's served rows carry the order leg, the fill economics and the named deciding body — the card renders them (a blotter row without the order id, instrument, side, notional, fee and state proved nothing happened; the M3/L4 finding). */
function submissionCard(scope: WorkspaceScope, submission: GatewaySubmissionRecord, viewAt: number): VNode {
  visibleAt(submission, availabilityOfSubmission(submission), viewAt, submission.submissionId);
  const badge = submissionVerdictBadgeOf(submission);
  assertVerdictFaithful(submission, badge);
  const order = submission.order;
  const fill = submission.fill;
  return v('div', { class: `card verdict-${badge.kind}` }, [
    v('div', { class: 'card-title' }, [submission.submissionId]),
    v('span', { class: `badge badge-${badge.kind}` }, [badge.label]),
    factRow('verdict detail', badge.detail),
    ...(order === undefined ? [] : [factRow('order', `${order.clientOrderId} · ${order.instrumentId} ${order.side} ${order.kind} ${order.quantity}${order.price === undefined ? '' : ` @ ${order.price}`}`)]),
    ...(fill === undefined ? [] : [factRow('fill', `${fill.state} · notional ${fill.notional} · fee ${fill.fee}`)]),
    ...(submission.kind === 'refused' ? [factRow('refusal', refusalDetailOf(submission.refusal))] : []),
    ...(submission.decisionBody === undefined ? [] : [factRow('deciding body', submission.decisionBody)]),
    factRow('audit', submission.auditId),
  ]);
}

/** The refusal's honest one-line detail (the opaque stage payload carries the refusals' constraint ids, predicates and observed values — rendered when present, never invented). */
function refusalDetailOf(refusal: GatewayRefusal): string {
  const refusals = (refusal as { readonly refusals?: readonly { readonly constraintId?: unknown; readonly subject?: unknown; readonly predicate?: { readonly kind?: unknown; readonly bound?: unknown }; readonly observed?: unknown; readonly severity?: unknown }[] }).refusals;
  if (!Array.isArray(refusals) || refusals.length === 0) return `stage ${refusal.stage}`;
  const parts = refusals.map((entry) => {
    const subject = typeof entry.subject === 'string' ? entry.subject : 'subject';
    const predicate = entry.predicate;
    const kind = predicate !== null && typeof predicate === 'object' && typeof (predicate as { readonly kind?: unknown }).kind === 'string' ? (predicate as { readonly kind: string }).kind : 'predicate';
    const bound = predicate !== null && typeof predicate === 'object' && 'bound' in (predicate as Record<string, unknown>) ? String((predicate as { readonly bound: unknown }).bound) : 'unspecified';
    const observed = entry.observed === undefined || entry.observed === null ? 'unspecified' : String(entry.observed);
    const constraint = typeof entry.constraintId === 'string' ? ` (${entry.constraintId})` : '';
    return `${subject} ${kind} bound ${bound}, observed ${observed}${constraint}`;
  });
  return `stage ${refusal.stage}: ${parts.join('; ')}`;
}

/** The honest one-line resolution of one evidence ref against the outcome record that cites it (the lineage carries the shadow refs; the decision ref is the record's own — anything else stays a bare ref, L20). */
function decisionEvidenceLineOf(outcome: OutcomeRecord, kind: string, ref: string): string {
  if (kind === 'decision' && ref === outcome.decision.decisionRef) {
    return `the deciding record — body ${outcome.decisionBody ?? 'unspecified'}, disposition ${outcome.decision.disposition}`;
  }
  if (ref === outcome.lineage.shadowOutcomeRef) return 'the shadow realization of this outcome (the lineage shadow outcome ref)';
  if (ref === outcome.lineage.shadow.sessionId) return 'the session the decision ran in (the lineage shadow session)';
  if (ref === outcome.outcomeId) return 'this outcome record';
  return 'an evidence-family ref — the evidence read family owns its payload (L20)';
}

/**
 * THE DECISION DETAIL CARD (R3, the W-22 substance pass): an outcome
 * that carries the W-8 decision-substance fields renders its
 * decision's full audit story — the NAMED deciding body (not
 * 'unknown'), the published audit rationale (prose — an audit field
 * the boundary serves on the decision record, never hidden
 * chain-of-thought), the gateway's own risk checks with their
 * outcomes, and WORKING evidence chips (the §4.9 inline-open surface:
 * each ref resolves against the record that cites it, and the
 * outcome's own capsule badge opens the full payload + provenance).
 * The watch feed's stream cards keep the closed seven-lens shape;
 * this card is the Decisions section's own auditable detail.
 */
function decisionCard(scope: WorkspaceScope, outcome: OutcomeRecord, viewAt: number, openCapsule: string | null): VNode {
  visibleAt(outcome, availabilityOfOutcome(outcome), viewAt, outcome.outcomeId);
  const riskChecks = outcome.riskChecks ?? [];
  const evidenceRefs = outcome.evidence;
  const openedRef = evidenceRefs.find((entry) => openCapsule === `${entry.kind}:${entry.ref}`) ?? null;
  return v('div', { class: 'card decision-card', 'data-decision': outcome.decision.decisionRef }, [
    v('div', { class: 'card-title' }, [`Decision ${outcome.decision.decisionRef}`]),
    ...factRows([
      ['deciding body', outcome.decisionBody ?? 'unspecified'],
      ['disposition', outcome.decision.disposition],
      ['intent ref', outcome.decision.intentRef],
    ]),
    ...(outcome.decisionRationale === undefined ? [] : [v('p', { class: 'card-note decision-rationale' }, [outcome.decisionRationale])]),
    // FW-32-A (Round A blocker 2, the C02 lineage ask): THE PRODUCING-JOB
    // BACKLINK — a promoted decision cites the research job it came from
    // (the record's own additive `promotedFromJob` field), with a working
    // link that opens the job's detail sheet (the data-row sheet grammar
    // the Research section's own rows ride — the audit chain now reads
    // BOTH directions: the job cites its decision, the decision its job).
    ...(outcome.promotedFromJob === undefined ? [] : [
      factRow('producing job', outcome.promotedFromJob),
      v('div', { class: 'tm-playback' }, [
        v('button', { class: 'tm-button', 'data-row': `job:${outcome.promotedFromJob}`, type: 'button' }, ['Open the producing job']),
      ]),
    ]),
    ...(riskChecks.length === 0 ? [] : [
      v('div', { class: 'stream-checks' }, [
        v('span', { class: 'stream-label' }, ['Risk checks']),
        ...riskChecks.map((check) => statusPill(riskCheckToneOf(check.outcome), `${check.dimension}: ${check.outcome}`, 'check-pill')),
      ]),
    ]),
    v('div', { class: 'stream-evidence' }, [
      v('span', { class: 'stream-label' }, ['Evidence']),
      ...(evidenceRefs.length === 0
        ? [v('span', { class: 'stream-none' }, ['none'])]
        : evidenceRefs.map((entry) => capsuleBadge(entry.kind, entry.ref, openCapsule === `${entry.kind}:${entry.ref}`))),
      ...(openedRef === null ? [] : [capsulePayload(`${openedRef.kind}:${openedRef.ref}`, [
        `ref ${refLabelOf(openedRef.kind, openedRef.ref)}`,
        decisionEvidenceLineOf(outcome, openedRef.kind, openedRef.ref),
      ], `cited by the deciding record ${outcome.decision.decisionRef} of ${outcome.outcomeId} — resolved from the outcome record (L20)`)]),
      // the outcome's OWN working capsule chip (§4.9): opens the full payload + provenance inline
      capsuleInline(capsuleFromOutcome(scope, outcome), viewAt, openCapsule),
    ]),
  ]);
}

/** Render one job as an interactive list row (§4.4) — the facts live in the sheet (§4.5a). */
function jobPillOf(job: JobRecord): { tone: PillTone; label: string } {
  const status = job.status as 'submitted' | 'running' | 'complete' | 'failed' | 'blocked';
  return { tone: pillToneOfDomain(status), label: job.status };
}

/**
 * Render one job as an interactive list row (§4.4). D-17 (W-29): the row's
 * duration meta derives from the RECORD's own timestamps (completedAt −
 * submittedAt) — never from the session's observation points, which exist
 * only for the current launch's tracked job and die at every reload. Every
 * complete job with timestamps carries its duration on the row.
 */
function jobCard(scope: WorkspaceScope, job: JobRecord, viewAt: number): VNode {
  assertProjectScope(scope, job);
  visibleAt(job, availabilityOfJob(job), viewAt, job.jobId);
  const elapsed = elapsedMsOfJobRecord(job);
  return listRow({
    icon: 'flask',
    title: job.jobId,
    subtitle: `${job.kind} job`,
    pill: jobPillOf(job),
    ...(elapsed !== null ? { meta: formatDurationMs(elapsed) } : {}),
    rowId: `job:${job.jobId}`,
  });
}

/**
 * The job's detail sheet (§4.5a) — the same availability + scope gates as
 * the row. D-17 (W-29): the METRICS elapsed derives from the RECORD's own
 * timestamps (completedAt − submittedAt, elapsedMsOfJobRecord) — the
 * root-cause fix for the "elapsed: pending" the personas and the Lead met
 * on COMPLETE jobs with BOTH timestamps present (the seed job:57d1815d, the
 * Lead's fresh kickoff job:1f7a71dc): the sheet used renderJobProgress over
 * the SESSION's observation points (empty for every non-tracked job and
 * after every reload), so the truth sitting in the record never rendered.
 * 'pending' shows ONLY while the record genuinely carries no completedAt.
 *
 * FW-32-A (Round A blocker 2): THE PROMOTION — a completed research job
 * whose result is a RELEASE CANDIDATE carries the "Propose as decision"
 * affordance (the host-owned POST /v1/jobs/:jobId/promote route), and a
 * job whose decision is already promoted (this workspace's own outcome
 * records cite it through the additive `promotedFromJob` backlink) renders
 * the promoted state — the decision ref, never a second button (the route
 * is idempotent; the affordance's honest end state is "promoted").
 */
function jobSheet(scope: WorkspaceScope, job: JobRecord, viewAt: number, promotion: { readonly decisionRef: string } | null): VNode[] {
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
  const elapsed = elapsedMsOfJobRecord(job);
  const metrics: DefinitionSection = {
    eyebrow: 'METRICS',
    pairs: [['elapsed', elapsed === null ? 'pending' : formatDurationMs(elapsed)]],
  };
  // THE RESULT SECTION (the R1 fix): when the job record carries its
  // completion payload, the deliverable renders READABLY here — the
  // research job's release candidate (spec id, version, lineage)
  // instead of a dialog that proves the job ran while hiding what it
  // produced (0/15 evaluators could read the deliverable).
  const result = jobResultSectionOf(job);
  // FW-32-A: the promotion lookup + the promotable gate (a completed
  // research job with a release-candidate result — the route's own
  // eligibility, mirrored here so the affordance never renders for a
  // job the route would honestly refuse with the typed 409). The cast
  // is hoisted OUT of any template-literal interpolation (the
  // erasable-subset law) — and the payload's shape is named at MODULE
  // scope (a brace-free annotation inline: the stripper's brace-pairing
  // pairs an inline object-literal annotation's { with a later cast's },
  // swallowing the ternary's else arm — the boot-path law).
  const resultPayload: JobResultPayload | null = jobResultPayloadOf(job);
  const resultKind = resultPayload !== null && typeof resultPayload.kind === 'string' ? resultPayload.kind : null;
  const promotable = job.kind === 'research' && job.status === 'complete' && resultKind === 'release-candidate';
  const identity: DefinitionSection = {
    eyebrow: 'IDENTITY',
    pairs: [['job id', job.jobId], ['kind', job.kind], ['project', job.project]],
  };
  // FW-32-A: the promoted state rides the sheet's own definition grid (the
  // decision ref — the audit chain's new link); the PROPOSE affordance
  // renders as the sheet's single primary action card, exactly like the
  // sibling sections' section-action pattern.
  const promotionSection: DefinitionSection | null = promotion === null ? null : {
    eyebrow: 'PROMOTION',
    pairs: [
      ['status', 'promoted as a decision'],
      ['decision', promotion.decisionRef],
    ],
  };
  const proposeAffordance: VNode[] = promotable && promotion === null
    ? [v('div', { class: 'card', 'data-job-promotion': 'available' }, [
        v('div', { class: 'card-title' }, ['Promotion']),
        v('p', { class: 'card-note' }, ['Propose this release candidate as a decision — the promotion mints a decision record that cites this job and its deliverable, and it renders in the Decisions section with a backlink here.']),
        v('div', { class: 'tm-playback' }, [
          v('button', { class: 'tm-button', 'data-action': 'job-promote', 'data-job-promote': job.jobId, type: 'button' }, ['Propose as decision']),
        ]),
      ])]
    : [];
  return [
    ...detailSheet({
      sheetId: `job:${job.jobId}`,
      title: job.jobId,
      subtitle: `${job.kind} job${result === null ? '' : ' · result available'}`,
      details: [status, metrics, ...(result === null ? [] : [result]), ...(promotionSection === null ? [] : [promotionSection]), identity],
    }),
    ...proposeAffordance,
  ];
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
        ['evidence', outcome.evidence.map((entry) => refLabelOf(entry.kind, entry.ref)).join(', ') || 'none'],
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

/**
 * Render one post-mortem as an OUTCOMES-section card (D-2, the W-24
 * fix): the section's subtitle promises "Results and post-mortems",
 * but only the outcome rendered — the post-mortem was reachable solely
 * through its evidence capsule and the Lessons section. The card
 * carries the post-mortem's own id, the outcome it ATTACHES TO
 * (subject.outcomeRecordRef), the happened/gap summary and every
 * hypothesis finding (class + confidence + note, verbatim — the
 * console renders what the boundary served, L20). Same scope + L4
 * availability gates as every sibling card in the section.
 */
function outcomePostMortemCard(scope: WorkspaceScope, postMortem: PostMortemRecord, viewAt: number): VNode {
  assertProjectScope(scope, { tenant: postMortem.lineage.tenant, project: postMortem.lineage.project });
  visibleAt(postMortem, availabilityOfPostMortem(postMortem), viewAt, postMortem.postMortemId);
  return v('div', { class: 'card post-mortem', 'data-post-mortem': postMortem.postMortemId }, [
    v('div', { class: 'card-title' }, [postMortem.postMortemId]),
    ...factRows([
      ['outcome', postMortem.subject.outcomeRecordRef],
      ['outcome class', postMortem.subject.outcomeClass],
      ['disposition', postMortem.happened.disposition],
      ['realized outcome', renderDecimal(postMortem.happened.realizedOutcome)],
      ['realized gap', postMortem.gap.realizedGap ?? 'none'],
      ['within tolerance', postMortem.gap.withinTolerance === null ? 'unknown' : String(postMortem.gap.withinTolerance)],
      ['hypotheses', String(postMortem.hypotheses.length)],
    ]),
    // the findings: each hypothesis's own class, confidence and note,
    // verbatim from the served record (an attribution, never a re-read).
    ...postMortem.hypotheses.map((hypothesis) => factRow(
      `hypothesis ${hypothesis.class}`,
      hypothesis.note === null ? `confidence ${hypothesis.confidence}` : `confidence ${hypothesis.confidence} — ${hypothesis.note}`,
    )),
  ]);
}

/** Render one knowledge entry. D-18 (W-29 wave 2): the card leads with ONE human sentence — the claim in words + the confidence (L2's finding: the lessons rendered as raw field tuples; the Inbox's plain-English copy is the shape to follow) — with the full typed record beneath it. */
function knowledgeCard(scope: WorkspaceScope, knowledge: ServedKnowledge, viewAt: number): VNode {
  assertProjectScope(scope, knowledge.record);
  visibleAt(knowledge, availabilityOfKnowledge(knowledge), viewAt, knowledge.record.knowledgeId);
  const claim = knowledge.record.claim;
  const dimension = claim.dimension === null || claim.dimension.length === 0 ? '' : ` (${claim.dimension})`;
  const summary = `A ${claim.kind} lesson the firm treats as ${claim.polarity}${dimension} — confidence ${knowledge.record.confidence}, from ${knowledge.record.evidenceCount} piece${knowledge.record.evidenceCount === 1 ? '' : 's'} of evidence.`;
  return v('div', { class: 'card lesson-card', 'data-lesson': knowledge.record.knowledgeId }, [
    v('div', { class: 'card-title' }, [knowledge.record.knowledgeId]),
    v('span', { class: `badge badge-knowledge-${knowledge.status}` }, [knowledge.status]),
    v('p', { class: 'objective', 'data-lesson-summary': 'true' }, [summary]),
    ...factRows([
      ['claim kind', claim.kind],
      ['polarity', claim.polarity],
      ['dimension', claim.dimension ?? 'none'],
      ['confidence', knowledge.record.confidence],
      ['evidence count', String(knowledge.record.evidenceCount)],
      ['valid from', formatInstantUtc(knowledge.record.validity.from)],
      ['valid to', formatInstantUtc(knowledge.record.validity.to)],
    ]),
  ]);
}

/**
 * FW-32-B (b2) — THE ONE EVIDENCE FOLD: the capsule list the Evidence
 * section renders, derived ONCE here (every read family's projection
 * + the D-9 jobs lane, in the section's own order) and consumed by
 * BOTH the Evidence section AND Home's EVIDENCE CAPSULES stat — one
 * source of truth, so the glance-level stat can never disagree with
 * the section again (M1/M3/S2's finding: "Home says 6 while Evidence
 * lists 9" — the jobs lane was missing from Home's count).
 */
function evidenceCapsulesOf(state: WorkspaceState, viewAt: number): readonly EvidenceCapsule[] {
  const scope = state.scope;
  return [
    ...projectToView(state.outcomes, viewAt, availabilityOfOutcome).map((outcome) => capsuleFromOutcome(scope, outcome)),
    ...projectToView(state.postMortems, viewAt, availabilityOfPostMortem).map((postMortem) => capsuleFromPostMortem(scope, postMortem)),
    ...projectToView(state.knowledge, viewAt, availabilityOfKnowledge).map((knowledge) => capsuleFromKnowledge(scope, knowledge)),
    ...projectToView(state.submissions, viewAt, availabilityOfSubmission).map((submission) => capsuleFromSubmission(scope, submission)),
    // D-9 (W-28): the jobs lane — one capsule per COMPLETED job WITH a
    // result (the fold's own law), so the Evidence section lists the
    // job-derived capsules ALONGSIDE the read families: the research
    // result is no longer a lineage LEAF (no capsule referenced its
    // job; a fresh release-candidate result minted zero capsules — L2's
    // P10 finding). The jobs read (GET /v1/jobs) serves BOTH backings'
    // records (the durable lane hydrates through the same route), so
    // this fold covers the demo and the durable backing by construction.
    ...capsulesFromJobs(scope, projectToView(state.jobs, viewAt, availabilityOfJob)),
  ];
}

/** Render one evidence capsule as the §4.9 inline surface: the monospace content-address badge (the open button) + the source kind; when open, the payload (mono) + the provenance line render inline (refs — never recomputed, L20). D-18 (W-29 wave 2): the refs line rides the payload's hover title (M5's truncated-refs finding) — the FULL refs are never hidden by wrapping or abbreviation. */
function capsuleCard(capsule: EvidenceCapsule, viewAt: number, openCapsule: string | null): VNode {
  assertVisible({ datumRef: capsule.capsuleId, availableAt: capsule.availableAt }, viewAt);
  const refsLine = capsule.refs.length === 0 ? 'refs: none' : `refs: ${capsule.refs.map((entry) => refLabelOf(entry.kind, entry.ref)).join(', ')}`;
  return capsuleSurface({
    capsuleId: capsule.capsuleId,
    sourceKind: capsule.sourceKind,
    open: openCapsule === capsule.capsuleId,
    payloadLines: [
      ...capsule.facts.map((entry) => `${entry.label}: ${entry.value}`),
      refsLine,
    ],
    refsLine,
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

/** The inbox panel (§4.10): the bell + list rows with read/unread state + mark-all-read + the per-notice read toggle (the W-14b J6 wiring — the workspace's own notice-read event, dispatched by the row's explicit affordance). D-13 (W-29): the panel renders the PROJECT-SCOPED inbox — only this scope's own folded notices list here (the state keeps every session notice, append-only; another desk's notices stay in their own desk's inbox). */
function inboxPanel(state: WorkspaceState, viewAt: number): VNode {
  // D-13: the scoped view — the fold-scoping pattern every section panel
  // follows (the section folds derive from the state's own scope-gated
  // records; the inbox's records predate the current scope, so the scope
  // gate applies at the view).
  const inbox = scopedInbox(state.inbox, state.scope);
  const unread = unreadCount(inbox);
  const projected = projectToView(inbox.notices, viewAt, (record) => record.at);
  const rows = projected.map((record) => {
    const copy = noticeCopyOf(record.kind);
    const isRead = inbox.readNoticeIds.includes(record.noticeId);
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
      // The per-notice read toggle rides the revealed details (a
      // button inside the native <summary> would toggle the accordion
      // on the same click); unread rows only — a read row carries no
      // dead button.
      ...(isRead ? {} : { actions: [v('button', { class: 'row-action notice-read-toggle', 'data-action': 'notice-read', 'data-notice-read': record.noticeId, type: 'button', 'aria-label': `Mark "${record.title}" as read` }, ['Mark read'])] }),
    });
  });
  return v('aside', { class: 'inbox', 'data-unread': String(unread) }, [
    v('h2', {}, [`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`]),
    // D-13: the scoping is STATED, not implied — each desk sees its own
    // notices; cross-project notices never render in another desk's inbox.
    v('p', { class: 'hint', 'data-inbox-scope': state.scope.projectId }, [`Notices for this project (${state.scope.projectId}) — each desk sees its own; cross-project notices stay in their own desk's inbox.`]),
    v('button', { class: 'inbox-read-all', 'data-action': 'notices-read-all', type: 'button' }, ['Mark all read']),
    ...rows,
    ...(projected.length === 0 ? [sectionEmpty('inbox')] : []),
  ]);
}

/**
 * The Time Machine bar (§4.8): the mode select, the scrubber, the
 * playback controls, the mono readout, the projection notice.
 * FW-32-B (Round A blocker 4): the scrubber range anchors to the
 * PROJECT'S OWN EVENT HISTORY — historyFloorOf derives the floor from
 * the records the state holds (the honest-derivation law; never a
 * fabricated instant, never the session start when history exists).
 * While a drag is in flight (the app layer's pinned bounds — the
 * J3/J5 beat-race discipline), the PINNED bounds render so the range
 * never re-anchors mid-drag; the pinned floor rides the SAME
 * derivation the pin captured, disclosed the same way.
 */
function timeMachineBar(state: WorkspaceState, viewAt: number, view: ShellView): VNode {
  const progress = playbackProgressOf(state.timeMachine);
  const anchorAt = state.timeMachine.anchorAt;
  const history = historyFloorOf(state);
  const range = view.scrubBounds === null
    ? { floorAt: Math.min(history.floorAt, anchorAt), anchorAt, derived: history.derived }
    : { floorAt: Math.min(view.scrubBounds.min, view.scrubBounds.max), anchorAt: Math.max(view.scrubBounds.min, view.scrubBounds.max), derived: history.derived };
  return v('div', { class: 'timemachine', 'data-mode': state.timeMachine.mode }, [
    timeMachineControls({
      mode: state.timeMachine.mode,
      viewAt,
      range,
      // R10 (W-25C): the control renders "Pause" only while playback
      // is actually ADVANCING — a PAUSED playback renders "Play" (the
      // control's resume face; the view instant is frozen at the last
      // tick's instant until then).
      playing: state.timeMachine.mode === 'playback' && state.timeMachine.playback !== null && !state.timeMachine.playback.paused,
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
  // directly below); a progress note ONLY while a launch is genuinely
  // IN FLIGHT. Mirrors launchPanel's own states — never a dead button
  // (a launch-start while a draft is open would be refused by the
  // handler; the hero shows the honest state instead).
  // D-11 (W-29): the banner is PHASE-DRIVEN, never progress-presence-
  // driven. The pre-fix test (draft === null && progress.length === 0
  // && error === null) stayed false FOREVER after any launch — the
  // progress array is append-only and no event ever cleared it, so a
  // COMPLETED launch kept the "A launch is in progress" banner and hid
  // the launch-entry buttons (M4's finding: a second launch required a
  // page reload). A concluded launch (launched/failed, no open wizard)
  // now restores the CTA; the launch panel below keeps the concluded
  // launch's own cards (result, progress, Start over).
  // D-15 (W-29 wave 2): the hero reads the SCOPE-GUARDED launch slice —
  // another desk's concluded launch never drives this desk's hero (the
  // CTA renders there; the launched desk keeps its own banner/cards).
  const launch = launchOfScope(state);
  const draftActive = launch.draft !== null && (launch.phase === 'draft' || launch.phase === 'idle');
  const launchInFlight = launch.phase === 'launching';
  const heroCta: VNode | undefined = draftActive
    ? v('p', { class: 'hero-note', 'data-hero-launch': 'draft' }, ['The launch wizard is open — continue below.'])
    : launchInFlight
      ? v('p', { class: 'hero-note', 'data-hero-launch': launch.phase }, ['A launch is in progress — details below.'])
      : v('button', { class: 'hero-cta', 'data-action': 'launch-start', type: 'button' }, ['Describe your goal']);
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
  const snapshots = projectToView(state.orgSnapshots, viewAt, availabilityOfOrgSnapshot);
  // FW-32-B (b2): Home's EVIDENCE CAPSULES tile counts the ONE evidence
  // fold — the same list the Evidence section renders (jobs lane
  // included), so the stat and the section can never disagree.
  const capsuleCount = evidenceCapsulesOf(state, viewAt).length;
  // D-13 (W-29): the unread tile + the activity timeline render the
  // PROJECT-SCOPED inbox — another desk's notices never count here.
  const scopedNotices = scopedInbox(state.inbox, state.scope);
  const unread = unreadCount(scopedNotices);
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
  const notices = projectToView(scopedNotices.notices, viewAt, (record) => record.at);
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
    // D-9 (W-28): the completed job's OWN evidence capsule renders INLINE
    // beside the sheet (the same §4.9 convention as the outcome's capsule
    // under Outcomes and the submission's under Execution) — the
    // bidirectional affordance: the result view links its capsule (the
    // fold mints one only for a COMPLETED job WITH a result; a pending or
    // failed job renders no capsule — nothing fabricated, L20).
    //
    // FW-32-A (Round A blocker 2): the promoted decision of THIS job, when
    // the workspace's own outcome records cite it (the additive
    // `promotedFromJob` backlink — the same lineage the Decisions section
    // renders); null while none does (the honest pre-promotion state).
    const promotion = state.outcomes.find((outcome) => outcome.promotedFromJob === job.jobId) ?? null;
    return [
      ...jobSheet(state.scope, job, viewAt, promotion === null ? null : { decisionRef: promotion.decision.decisionRef }),
      ...capsulesFromJobs(state.scope, [job]).map((capsule) => capsuleInline(capsule, viewAt, view.openCapsule)),
    ];
  }
  const snapshot = state.orgSnapshots.find((candidate) => candidate.organizationRef === sheet.id);
  if (snapshot === undefined) return [];
  return snapshotSheet(state.scope, snapshot, viewAt);
}

/**
 * D-12 (W-29 wave 2): THE STANDALONE RESEARCH-SUBMIT CARD — the
 * Research section's own submission affordance. Closed: ONE primary
 * action ("Submit research") in a card that states the scope it will
 * submit into. Open: the two-field form (objective + notes) riding the
 * SAME labeled-input scaffold and beat-safe data-field pattern as the
 * launch wizard, an inline error line for the typed validation gate or
 * a failed submission (rendered in the form's own card — an error the
 * user must read to fix is never a toast), and exactly TWO actions
 * (Submit / Cancel). Null on the launchpad (no project exists — the
 * launch wizard is the only path there, by design).
 */
function researchSubmitCard(state: WorkspaceState, view: ShellView): VNode | null {
  if (isLaunchpadScope(state.scope.projectId)) return null;
  if (view.researchSubmit === null) {
    return v('div', { class: 'card research-submit', 'data-research-submit': 'closed' }, [
      v('div', { class: 'card-title' }, ['Submit research']),
      v('p', { class: 'card-note' }, [`Run a research job in this project (${state.scope.projectId}) directly — no launch wizard required. The job lists below and advances like any other.`]),
      v('div', { class: 'tm-playback' }, [
        v('button', { class: 'tm-button', 'data-action': 'research-submit-open', type: 'button' }, ['Submit research']),
      ]),
    ]);
  }
  const form = researchFormValuesOf(view.researchSubmit.edits);
  return v('div', { class: 'card research-submit', 'data-research-submit': 'open' }, [
    v('div', { class: 'card-title' }, ['Submit research']),
    v('p', { class: 'card-note' }, [`The job submits into the current project (${state.scope.projectId}) through the same research route a launch's kickoff job rides.`]),
    ...labeledInput({ label: 'Objective', name: 'objective', value: form.objective, required: true, hint: 'One sentence — what this research run should investigate.', vocabulary: 'research' }),
    ...labeledInput({ label: 'Notes', name: 'notes', value: form.notes, hint: 'Optional context for the run.', vocabulary: 'research' }),
    ...(view.researchSubmit.error === null ? [] : [v('p', { class: 'field-error', role: 'alert', 'data-research-error': view.researchSubmit.error }, [view.researchSubmit.error])]),
    v('div', { class: 'tm-playback' }, [
      v('button', { class: 'tm-button', 'data-action': 'research-submit', type: 'button' }, ['Submit research job']),
      v('button', { class: 'tm-button', 'data-action': 'research-submit-cancel', type: 'button' }, ['Cancel']),
    ]),
  ]);
}

/**
 * D-15 (W-29 wave 2): THE LAUNCH SLICE'S SCOPE GUARD. The launch flow
 * leaves its CONCLUDED state (the launched params card, the progress
 * card, the failure card) on the launch slice forever — and the
 * workspace resets every record on a scope switch but NEVER the launch
 * slice, so a desk switch rendered the PREVIOUS desk's launch params
 * inside the OTHER scope's sections (M4/M5/L5/S1's finding; the Lead's
 * W-28 note: the Market World panel showed the transient launch
 * context's capital in another desk's view). The guard: the launch
 * slice renders only within its OWN scope — launch.projectId (set by
 * launch-submitted) equals the current scope. An open WIZARD DRAFT
 * (projectId null — pre-project, the draft is what the user is typing
 * now) renders everywhere: the primary flow is scope-independent and
 * wiping it on a switch would lose the user's work. A foreign-scope
 * concluded launch renders as the QUIET initial state in this desk's
 * view — the hero shows its CTA, the launch panel its idle card — and
 * switching BACK to the launched desk restores its own concluded cards.
 */
function launchOfScope(state: WorkspaceState): LaunchState {
  const launch = state.launch;
  if (launch.projectId === null) return launch;
  return launch.projectId === state.scope.projectId ? launch : initialLaunchState();
}

/**
 * D-15 (W-29 wave 2): THE ONE LIFECYCLE READ. The Goal section and the
 * export both read the PROJECT RECORD's own lifecycle.status (the
 * boundary's stamp — one source of truth); the ORGANIZATION's operating
 * status is a DIFFERENT entity's own truth (the compiled team working
 * the goal — Home's organization tile reads the same snapshot). The
 * defect was the unexplained juxtaposition: a launched desk showed
 * lifecycle 'draft' on Goal while Home/Organization showed 'active',
 * with nothing telling the reader these are two different states (the
 * frozen backing binds the organization without a lifecycle event —
 * bindOrganization sets organizationRef and never the status; the
 * lifecycle moves only through an explicit transition). The rows below
 * render BOTH truths, each labeled as its own entity, and the note
 * states the seam in plain words — never a fabricated 'active'.
 */
function lifecycleRowsOf(state: WorkspaceState, viewAt: number): { readonly rows: readonly (readonly [string, string])[]; readonly note: string | null } {
  const project = state.project;
  if (project === null) return { rows: [], note: null };
  const bound = project.lifecycle.organizationRef;
  let organization = 'not bound';
  if (bound !== null) {
    // The LATEST visible snapshot for the bound organization (the erasable-
    // subset law: no call-site type arguments — a plain accumulator walk).
    let latest: OrgStatusSnapshot | null = null;
    for (const candidate of state.orgSnapshots) {
      if (candidate.organizationRef !== bound || availabilityOfOrgSnapshot(candidate) > viewAt) continue;
      if (latest === null || candidate.at > latest.at) latest = candidate;
    }
    organization = latest === null ? 'bound (no snapshot at this view instant)' : `${latest.status} (observed ${formatTimeUtc(latest.at)})`;
  }
  const rows: readonly (readonly [string, string])[] = [
    ['lifecycle', project.lifecycle.status],
    ['organization', organization],
  ];
  const note = bound !== null
    ? 'The project record\'s lifecycle and the organization\'s operating status are separate states — the record moves only through an explicit lifecycle event.'
    : null;
  return { rows, note };
}

/** The per-section panel — the selected section's projection at the view instant. */
function sectionPanel(state: WorkspaceState, viewAt: number, view: ShellView = defaultShellView(state)): VNode {
  const scope = state.scope;
  const selector = state.selectedSection;
  if (selector === 'goal') {
      const rows: VNode[] = [];
      if (state.project !== null) {
        visibleAt(state.project, availabilityOfProject(state.project), viewAt, state.project.id);
        // D-15 (W-29 wave 2): THE ONE LIFECYCLE READ — the project record's
        // own lifecycle status (the boundary's stamp — the same source the
        // export's workspace block carries verbatim) with the bound
        // organization's own operating status beside it, each labeled as
        // its own entity, plus the plain-words note on the seam.
        const lifecycle = lifecycleRowsOf(state, viewAt);
        rows.push(v('div', { class: 'card' }, [
          v('div', { class: 'card-title' }, [state.project.name]),
          ...factRows([
            ['project', state.project.id],
            ['tenant', state.project.tenantId],
            ...lifecycle.rows,
            ['execution mode', state.project.executionMode],
            ['goal ref', `${state.project.lineage.goal.goalId}@${state.project.lineage.goal.version}`],
            ['constraint set', `${state.project.lineage.constraintSet.id}@${state.project.lineage.constraintSet.version}`],
          ]),
          ...(lifecycle.note === null ? [] : [v('p', { class: 'card-note', 'data-lifecycle-note': 'true' }, [lifecycle.note])]),
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
          ...state.goal.successCriteria.criteria.map((criterion) => factRow(`criterion ${criterion.id}`, `${criterion.metric} ${predicatePhraseOf(criterion.predicate)}`)),
        ]));
      }
      if (state.constraintSet !== null) {
        rows.push(v('div', { class: 'card' }, [
          v('div', { class: 'card-title' }, ['Constraints']),
          // R5: the bound rides the predicate label — a limit without
          // a number is not a limit (the number always lived in the
          // record's predicate.bound/value; it reaches the pixel now).
          ...state.constraintSet.constraints.map((constraint) => factRow(`${constraint.severity} ${constraint.id}`, `${constraint.domain}.${constraint.subject} ${predicatePhraseOf(constraint.predicate)}`)),
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
      // D-8 (W-28): the section is bound to the PROJECT'S OWN PERSISTED
      // WORLD first (state.world — the host goal route's additive `world`
      // field, read at boot and on every scope refetch), NOT to the
      // in-session launch draft: after a reload, a scope switch or a cold
      // start the section renders the SCOPE's own markets/venues/data
      // sources (the pre-fix behavior — the draft was the only source —
      // rendered the teaching empty state forever, and the session draft
      // could BLEED across scopes when one stayed open). The in-session
      // draft remains the source while the wizard is open in a scope that
      // has no world yet (the launchpad, a fresh boot); the teaching empty
      // state renders ONLY when the project genuinely has no world on
      // record (the demo scope — its seeded goal carries no world fields).
      const world = state.world;
      if (world !== null) {
        return v('section', { class: 'panel', 'data-section': 'market-world' }, [
          v('div', { class: 'card', 'data-market-world': 'persisted' }, [
            v('div', { class: 'card-title' }, ['Market world']),
            ...factRows([
              ['markets', world.markets.join(', ')],
              ['venues', world.venues.join(', ')],
              ['data sources', world.dataSources.join(', ')],
              ['execution mode', world.executionMode],
              ['capital budget', renderDecimal(world.capitalBudget)],
              ['risk budget', renderDecimal(world.riskBudget)],
              ['horizon', `${formatInstantUtc(world.horizon.startsAt)} -> ${formatInstantUtc(world.horizon.endsAt)}`],
            ]),
            v('p', { class: 'card-note' }, ['The launch specification this project\'s market world was set to — persisted with the project, restored on every visit.']),
          ]),
        ]);
      }
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
        factRow('playback', state.timeMachine.playback === null ? 'not armed' : `from ${formatInstantUtc(state.timeMachine.playback.fromAt)} step ${state.timeMachine.playback.stepMs}ms after ${state.timeMachine.playback.ticks} ticks${state.timeMachine.playback.paused ? ' (paused)' : ''}`),
      ];
      return v('section', { class: 'panel', 'data-section': 'time-machine' }, [
        v('div', { class: 'card' }, [v('div', { class: 'card-title' }, ['Time Machine']), ...knowable]),
        // D-18 (W-29 wave 2): the one-line explainer for the jargon labels
        // (S2's finding: "T-x is cryptic pre-click") — the modes' meanings
        // in plain words, right on the section that owns them.
        v('p', { class: 'hint', 'data-tm-explainer': 'true' }, ['The modes: LIVE shows the world as the API serves it now; T-x views it as of x seconds before the latest datum; TIMESTAMP picks one explicit instant; PLAYBACK plays history forward, one knowable-then step at a time.']),
        v('p', { class: 'hint' }, ['Every visible datum above passed the availability projection for this view instant (L4).']),
      ]);
  } else if (selector === 'research') {
      const projected = projectToView(state.jobs.filter((job) => job.kind === 'research'), viewAt, availabilityOfJob);
      const cards = projected.map((job) => jobCard(scope, job, viewAt));
      // D-12 (W-29 wave 2): THE STANDALONE RESEARCH-SUBMIT AFFORDANCE —
      // the launch flow was the ONLY path to submit a research job
      // (S4's P03 finding: "no direct submit-job control in Research —
      // new jobs only originate from the launch wizard"). The
      // affordance follows the section-action pattern (a card with ONE
      // primary action, like the sibling sections' Refresh) and opens a
      // two-field form that rides the SAME beat-safe data-field pattern
      // as the launch wizard (buffered edits, committed on submit). It
      // renders ONLY inside a project scope (the launchpad has no
      // project to submit into — the wizard is the only path there, by
      // design), and it submits into the CURRENT project through the
      // frozen POST /v1/jobs/research route — the same plumbing the
      // launch's kickoff job rides.
      const submitCard = researchSubmitCard(state, view);
      return v('section', { class: 'panel', 'data-section': 'research' }, [
        ...(submitCard === null ? [] : [submitCard]),
        ...cards,
        ...(projected.length === 0
          ? [submitCard === null
              ? sectionEmpty('research')
              // The affordance changes what the teaching sentence must
              // say: a research job no longer requires a launch.
              : emptyState({ icon: 'flask', title: 'No research jobs at this view instant.', sentence: 'Research jobs start when a project launches — or submit one directly with the button above.', action: { label: 'Launch from Goal', target: 'goal' } })]
          : []),
      ]);
  } else if (selector === 'experiments') {
      const projected = projectToView(state.jobs, viewAt, availabilityOfJob);
      const experiments: Map<string, string> = new Map();
      for (const outcome of projectToView(state.outcomes, viewAt, availabilityOfOutcome)) {
        if (outcome.lineage.experiment !== null) experiments.set(outcome.lineage.experiment.experimentRef, outcome.lineage.experiment.trialRef);
      }
      const cards = projected.map((job) => jobCard(scope, job, viewAt));
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
      // THE DECISION DETAIL CARDS (R3, the W-22 substance pass): the
      // outcomes that carry the W-8 decision-substance fields (a named
      // deciding body, the audit rationale, the risk checks) render
      // their decision's auditable story BEFORE the stream — the
      // section's own purpose; the watch feed keeps the closed
      // seven-lens shape beneath them.
      const decisionOutcomes = projectToView(state.outcomes, viewAt, availabilityOfOutcome)
        .filter((outcome) => outcome.decisionBody !== undefined || outcome.decisionRationale !== undefined || (outcome.riskChecks?.length ?? 0) > 0);
      return v('section', { class: 'panel', 'data-section': 'decisions' }, [
        ...decisionOutcomes.map((outcome) => v('div', { class: 'decision-block' }, [
          decisionCard(scope, outcome, viewAt, view.openCapsule),
        ])),
        // D-18 (W-29 wave 2): the "Watch" heading explains itself — the
        // hover/aria description + ONE plain line beneath it (S2's finding:
        // "'Watch' is unexplained jargon"; the heading alone named nothing).
        v('div', { class: 'watch' }, [
          v('h2', { class: 'watch-heading', title: 'Watch — the live decision stream: what each agent proposed and how the gateway answered', 'aria-label': 'Watch — the live decision stream' }, ['Watch']),
          v('p', { class: 'hint', 'data-watch-explainer': 'true' }, ['The live decision stream — what each agent proposed, the evidence it consulted, and how the gateway answered.']),
          ...watchFeed.map((event) => watchEventRow(scope, event, viewAt, view.openCapsule)),
        ]),
        ...submissions.map((submission) => v('div', { class: 'decision-block' }, [
          submissionCard(scope, submission, viewAt),
          capsuleInline(capsuleFromSubmission(scope, submission), viewAt, view.openCapsule),
        ])),
        ...(submissions.length === 0 && watchFeed.length === 0 && decisionOutcomes.length === 0 ? [sectionEmpty('decisions')] : []),
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
          // R5 (the M5 finding, 8/15 personas failed here): every
          // constraint card renders its NUMERIC bound — the risk
          // surface showed 'outcome.capital.budget equals' with the
          // 300,000,000 served by the record but never rendered.
          ...state.constraintSet.constraints.map((constraint) => factRow(`${constraint.severity} ${constraint.id}`, `${constraint.domain}.${constraint.subject} ${predicatePhraseOf(constraint.predicate)}`)),
        ]));
      }
      // FW-32-A (Round A blocker 1 — the ONLY losing dimension,
      // risk_tooling 3.44 vs 3.56): THE STANDING UTILIZATION PANEL — the
      // risk manager's "where am I right now" answer in one glance. The
      // FW-31-A host-owned read (GET /v1/risk/utilization) serves per-bound
      // standing utilization + the active-breach aggregation; the panel
      // renders exactly what the read serves — the bound, the current
      // number (ONLY when the records on file produce a defensible one),
      // the honest ok/breach/unknown verdict (the unknown rendered AS
      // unknown — never a fabricated zero), and each row's own source
      // disclosure (exactly which records the number came from).
      //
      // THE L4 POINT-IN-TIME LAW (deliberate): this is a CURRENT-INSTANT
      // standing read — the panel names its own asOf and is NOT projected
      // through the Time Machine's view instant. Point-in-time risk is not
      // computable from the records on file (the read's own disclosure
      // says so); faking it would violate the anti-deception law.
      const utilization = state.riskUtilization;
      if (utilization !== null) {
        rows.push(v('div', { class: 'card', 'data-risk-utilization': 'bounds' }, [
          v('div', { class: 'card-title' }, ['Standing utilization']),
          ...utilization.bounds.map((bound) => v('div', { class: 'decision-block', 'data-risk-bound': bound.constraintId }, [
            v('div', { class: 'stream-checks' }, [
              v('span', { class: 'stream-label' }, [`${bound.severity} ${bound.constraintId} · ${bound.metric}`]),
              statusPill(bound.status === 'ok' ? 'live' : bound.status === 'breach' ? 'warn' : 'idle', bound.status, 'check-pill'),
            ]),
            ...factRows([
              ['bound max', bound.boundMax === null ? 'none declared (no max-side numeric bound)' : formatNumberGrouped(Number(bound.boundMax))],
              ['current', bound.current === null ? 'unknown — no defensible number on file' : formatNumberGrouped(bound.current)],
            ]),
            v('p', { class: 'hint', 'data-risk-source': bound.constraintId }, [bound.source]),
          ])),
          v('p', { class: 'hint' }, [`Standing read as of ${utilization.asOf} — the current instant, not projected to the view instant (point-in-time risk is not computable from the records on file).`]),
        ]));
        rows.push(v('div', { class: 'card', 'data-risk-utilization': 'breaches' }, [
          v('div', { class: 'card-title' }, [`Active breaches (${utilization.activeBreaches.length})`]),
          ...(utilization.activeBreaches.length === 0
            ? [v('p', { class: 'card-note' }, ['No refusal is on file for this project — nothing stands in breach.'])]
            : utilization.activeBreaches.map((breach) => v('div', { class: 'decision-block', 'data-risk-breach': breach.submissionId }, [
                v('div', { class: 'stream-checks' }, [
                  v('span', { class: 'stream-label' }, [breach.submissionId]),
                  statusPill('warn', breach.kind === 'risk_limits_refusal' ? 'risk-limits refusal' : `refused · ${breach.stage}`, 'check-pill'),
                ]),
                ...factRows([
                  ['stage', breach.stage],
                  ['at', breach.at],
                  ['audit', breach.auditId],
                  ...(breach.decisionBody === undefined ? [] : ([['deciding body', breach.decisionBody]] as const)),
                ]),
                ...(breach.violations === undefined ? [] : breach.violations.map((violation) => {
                  // the erasable-subset law: the cast hoists OUT of the
                  // template-literal interpolation.
                  const violationPredicate: { readonly kind?: unknown } = violation.predicate as { readonly kind?: unknown };
                  const violationKind = typeof violationPredicate?.kind === 'string' ? violationPredicate.kind : 'predicate';
                  return factRow(`violation ${violation.constraintId}`, `${violation.subject} ${violationKind} bound vs observed ${violation.observed}`);
                })),
                ...(breach.rationale === undefined ? [] : [v('p', { class: 'card-note decision-rationale' }, [breach.rationale])]),
              ]))),
          v('p', { class: 'hint', 'data-risk-disclosure': 'true' }, [utilization.disclosure]),
        ]));
      } else if (state.constraintSet !== null) {
        // The honest pre-read absence: the bounds are declared and enforced
        // (the gate's refusals carry receipts), but no standing read is on
        // record for this scope — a teaching note, never a fabricated meter.
        rows.push(v('p', { class: 'hint', 'data-risk-utilization': 'absent' }, ['No standing utilization read is on record for this scope — the declared bounds above are enforced at the pre-trade gate; the utilization read serves when the host route answers this project.']));
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
      // FW-32-B (b2): the section renders THE ONE fold (evidenceCapsulesOf
      // — the same list Home's stat counts; one source of truth).
      const capsules: readonly EvidenceCapsule[] = evidenceCapsulesOf(state, viewAt);
      return v('section', { class: 'panel', 'data-section': 'evidence' }, [
        ...capsules.map((capsule) => capsuleCard(capsule, viewAt, view.openCapsule)),
        ...(capsules.length === 0 ? [sectionEmpty('evidence')] : []),
      ]);
  } else if (selector === 'outcomes') {
      const projected = projectToView(state.outcomes, viewAt, availabilityOfOutcome);
      // D-2 (the W-24 fix): the post-mortems render in the section its
      // own subtitle promises them to ("Results and post-mortems") —
      // projected by their OWN availability gate (availabilityOfPostMortem),
      // exactly like the sibling sections (Lessons/Evidence) project them.
      const postMortemProjected = projectToView(state.postMortems, viewAt, availabilityOfPostMortem);
      const cards = projected.map((outcome) => v('div', { class: 'decision-block' }, [
        outcomeCard(scope, outcome, viewAt),
        // J7: the outcome's own evidence capsule renders INLINE (its
        // content-address badge opens the payload + provenance here).
        capsuleInline(capsuleFromOutcome(scope, outcome), viewAt, view.openCapsule),
        // D-2: the outcome's post-mortems render beneath it — the
        // card names the outcome it attaches to, so the pairing reads
        // even when the outcome itself is not visible at this instant;
        // the post-mortem's own evidence capsule renders INLINE beside
        // it (the same J7 convention as the outcome's capsule above).
        ...postMortemProjected
          .filter((postMortem) => postMortem.subject.outcomeRecordRef === outcome.outcomeId)
          .map((postMortem) => v('div', { class: 'decision-block' }, [
            outcomePostMortemCard(scope, postMortem, viewAt),
            capsuleInline(capsuleFromPostMortem(scope, postMortem), viewAt, view.openCapsule),
          ])),
      ]));
      // A post-mortem whose outcome is not visible at this view instant
      // (or whose outcome is absent from the projection) still renders —
      // its own card carries the attachment; nothing is dropped silently.
      const orphanedPostMortems = postMortemProjected
        .filter((postMortem) => !projected.some((outcome) => outcome.outcomeId === postMortem.subject.outcomeRecordRef));
      return v('section', { class: 'panel', 'data-section': 'outcomes' }, [
        ...cards,
        ...orphanedPostMortems.map((postMortem) => v('div', { class: 'decision-block' }, [
          outcomePostMortemCard(scope, postMortem, viewAt),
          capsuleInline(capsuleFromPostMortem(scope, postMortem), viewAt, view.openCapsule),
        ])),
        ...(projected.length + postMortemProjected.length === 0 ? [sectionEmpty('outcomes')] : []),
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

/**
 * FW-32-B (b4) — THE HORIZON REVIEW LINE: the launch review renders
 * the horizon HUMAN-READABLE (the console's own formatInstantUtc +
 * formatDurationMs discipline), never raw epoch ms (L1/M1/L3/M5's
 * finding: "horizon rendered as raw epoch ms at review"). An
 * unparseable pair renders verbatim — the review gate's problems card
 * owns the validation; this line never invents an instant.
 */
function horizonReviewLine(startsAt: string, endsAt: string): string {
  const start = Number.parseInt(startsAt, 10);
  const end = Number.parseInt(endsAt, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0 || end < start) {
    return `${startsAt} -> ${endsAt}`;
  }
  return `${formatInstantUtc(start)} -> ${formatInstantUtc(end)} (${formatDurationMs(end - start)})`;
}

/** The launch panel (the primary flow: the wizard's full field set + the review step + the two-step confirm + progress). */
function launchPanel(state: WorkspaceState, view: ShellView): VNode {
  const launch = launchOfScope(state); // D-15 (W-29 wave 2): the slice renders only within its OWN scope
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
            ['Horizon', horizonReviewLine(form.horizonStartsAt, form.horizonEndsAt)],
            ['Execution mode', form.executionMode],
            ['Preferences', form.preferences.length === 0 ? 'none' : form.preferences],
            ['Constraints', form.constraints.length === 0 ? 'none' : form.constraints],
            ['Success criteria', draft.successCriteria.map((criterion) => `${criterion.id}: ${criterion.metric} ${predicatePhraseOf(criterion.predicate)}`).join('; ')],
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
      timeMachine: timeMachineBar(state, viewAt, view),
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
