// @tradrl/web-console — watch mode (R37).
//
// THE LAW (UX.md, verbatim): "Show which agent acts, capability
// used, evidence consulted, proposal, challenge, risk checks and
// decision. Do not expose hidden chain-of-thought." And the Work
// Order: "NEVER hidden chain-of-thought (a render path that could
// surface reasoning text is a typed error; the watch record shapes
// are the API's org-status/job reads)."
//
// THE WATCH EVENT carries exactly UX.md's seven lenses — and NOTHING
// ELSE. Every field is a closed-vocabulary ref, enum or typed fact:
// there is structurally no field that could carry reasoning text.
// The builders fold the API's served records (org-status snapshots,
// job records, gateway submissions, outcomes, post-mortems) into
// watch events, and every builder passes the payload through
// `assertNoReasoningText` FIRST: a reasoning-shaped key anywhere in
// a record about to enter the watch surface is the typed
// ChainOfThoughtExposureError — the console refuses to ingest it
// rather than risk rendering it.
//
// Spec anchors: R37 (watchable agent organization), R45
// (provenance), L20 (the risk-check lens renders the gateway's
// verdicts; it never re-decides them).

import type {
  GatewaySubmissionRecord,
  JobRecord,
  OrgStatusSnapshot,
  OutcomeRecord,
  PostMortemRecord,
} from '../api/contracts';
import { ChainOfThoughtExposureError } from './errors';
import { assertProjectScope, tenantOfRecord, type WorkspaceScope } from './tenant';
import { canonicalJson } from './digest';

/**
 * The reasoning-shaped key vocabulary: any of these keys appearing
 * anywhere in a payload about to enter the watch surface is the
 * typed ChainOfThoughtExposureError. Closed, frozen, tested — the
 * firewall is code, not policy.
 */
export const REASONING_KEYS: readonly string[] = Object.freeze([
  'reasoning',
  'rationale',
  'chainOfThought',
  'chain_of_thought',
  'thought',
  'thoughts',
  'thinking',
  'innerMonologue',
  'inner_monologue',
  'monologue',
  'prompt',
  'systemPrompt',
  'system_prompt',
  'scratchpad',
  'deliberation',
  'explanation',
  'justification',
]);

/** `true` when a key is reasoning-shaped (case-insensitive containment of the vocabulary). */
function isReasoningKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return REASONING_KEYS.some((candidate) => lowered === candidate.toLowerCase() || lowered === `the${candidate.toLowerCase()}`);
}

/**
 * THE CHAIN-OF-THOUGHT FIREWALL: recursively scan a payload for
 * reasoning-shaped keys. The watch surface renders agents,
 * capabilities, evidence, proposals, challenges, risk checks and
 * decisions — a payload that carries hidden reasoning text is
 * refused loudly (typed error) BEFORE it can reach any render path.
 */
export function assertNoReasoningText(payload: unknown, path: string): void {
  if (typeof payload !== 'object' || payload === null) return;
  if (Array.isArray(payload)) {
    for (let index = 0; index < payload.length; index++) {
      assertNoReasoningText(payload[index], `${path}[${index}]`);
    }
    return;
  }
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (isReasoningKey(key)) {
      throw new ChainOfThoughtExposureError(
        `the watch surface cannot ingest ${path}.${key} — reasoning-shaped fields never reach the watch renders (R37: "Do not expose hidden chain-of-thought")`,
      );
    }
    assertNoReasoningText(value, `${path}.${key}`);
  }
}

/** One risk check as the watch surface renders it (the gateway's verdict, verbatim — never re-decided). */
export interface WatchRiskCheck {
  readonly dimension: string;
  readonly outcome: string;
}

/** One decision as the watch surface renders it. */
export interface WatchDecision {
  readonly kind: 'routed' | 'refused' | 'observed';
  readonly ref: string;
}

/**
 * THE WATCH EVENT — UX.md's seven lenses and nothing else. Every
 * field is a ref, an enum or a typed fact list: structurally
 * incapable of carrying reasoning text.
 */
export interface WatchEvent {
  /** The instant the watched act happened (the record's own instant — injected, never a wall clock). */
  readonly at: number;
  readonly tenantId: string;
  readonly projectId: string;
  /** Which agent acts (the acting instance ref; null when the read carries no agent). */
  readonly agent: string | null;
  /** The capability used (closed vocabulary; null when the read carries no capability). */
  readonly capability: string | null;
  /** The evidence consulted (typed refs into the API's evidence reads). */
  readonly evidenceConsulted: readonly { readonly kind: string; readonly ref: string }[];
  /** The proposal (an artifact ref). */
  readonly proposal: string | null;
  /** The challenge (the adversarial artifact's class ref). */
  readonly challenge: string | null;
  /** The risk checks (the gateway's dimensions and outcomes, verbatim). */
  readonly riskChecks: readonly WatchRiskCheck[];
  /** The decision. */
  readonly decision: WatchDecision | null;
}

/** The closed capability vocabulary the org-status/job reads actually carry (extended only when the API grows one). */
const CLOSED_CAPABILITIES: readonly string[] = Object.freeze(['research', 'learning', 'execution', 'organization']);

/** Guard: a capability in the closed vocabulary. */
export function isClosedCapability(value: string): boolean {
  return CLOSED_CAPABILITIES.includes(value);
}

/** The watch feed's deterministic ordering: by instant, then by the event's canonical form. */
export function orderWatchEvents(events: readonly WatchEvent[]): readonly WatchEvent[] {
  return [...events].sort((a, b) => (a.at === b.at ? (canonicalJson(a) < canonicalJson(b) ? -1 : 1) : a.at - b.at));
}

/**
 * Watch events from an org-status snapshot: the organization's
 * instances are the acting agents (one event per instance — the
 * lens stays per-act). The org-status read carries no capability or
 * proposal; those lenses render null (the console never invents
 * what the API does not serve).
 */
export function watchEventsFromOrgSnapshot(scope: WorkspaceScope, snapshot: OrgStatusSnapshot): readonly WatchEvent[] {
  assertProjectScope(scope, snapshot);
  assertNoReasoningText(snapshot, 'orgStatusSnapshot');
  return snapshot.instanceRefs.map((agent): WatchEvent => ({
    at: snapshot.at,
    tenantId: tenantOfRecord(snapshot),
    projectId: snapshot.project,
    agent,
    capability: 'organization',
    evidenceConsulted: [],
    proposal: null,
    challenge: null,
    riskChecks: [],
    decision: { kind: 'observed', ref: snapshot.organizationRef },
  }));
}

/** Watch event from a job record: the job machinery's async act (submitted -> running -> complete). */
export function watchEventFromJob(scope: WorkspaceScope, job: JobRecord): WatchEvent {
  assertProjectScope(scope, job);
  assertNoReasoningText(job, 'jobRecord');
  const event: WatchEvent = {
    at: job.completedAt ?? job.submittedAt,
    tenantId: tenantOfRecord(job),
    projectId: job.project,
    agent: null,
    capability: isClosedCapability(job.kind) ? job.kind : null,
    evidenceConsulted: [],
    proposal: job.jobId,
    challenge: null,
    riskChecks: [],
    decision: { kind: 'observed', ref: job.jobId },
  };
  return event;
}

/**
 * Watch event from a gateway submission: the risk-check lens renders
 * the gateway's refusal dimensions VERBATIM (L20 — the console
 * renders the verdict, it never re-decides it), and the decision
 * lens carries the gateway's own kind. The refusal's opaque payload
 * passes the firewall: a reasoning-shaped key refuses the ingest.
 */
export function watchEventFromSubmission(scope: WorkspaceScope, submission: GatewaySubmissionRecord): WatchEvent {
  // The submission record carries no scope fields of its own — it is
  // the console's OWN execution-route response (the boundary scopes
  // it server-side; a cross-tenant attempt never returns a record,
  // it returns the typed TenantIsolationError). The event therefore
  // inherits the workspace's scope.
  assertNoReasoningText(submission, 'gatewaySubmissionRecord');
  const riskChecks: WatchRiskCheck[] = submission.kind === 'refused'
    ? [{ dimension: submission.refusal.stage, outcome: 'refused' }]
    : [];
  const proposal = submission.kind === 'routed' ? submission.requestRef : submission.submissionId;
  const event: WatchEvent = {
    at: submission.kind === 'routed' ? submission.routedAt : submission.refusedAt,
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    agent: null,
    capability: 'execution',
    evidenceConsulted: [{ kind: 'gateway-audit', ref: submission.auditId }],
    proposal,
    challenge: null,
    riskChecks,
    decision: { kind: submission.kind, ref: submission.submissionId },
  };
  return event;
}

/** Watch event from an outcome record: the evidence lens carries the outcome's own evidence refs. */
export function watchEventFromOutcome(scope: WorkspaceScope, outcome: OutcomeRecord): WatchEvent {
  assertProjectScope(scope, outcome);
  assertNoReasoningText(outcome, 'outcomeRecord');
  const event: WatchEvent = {
    at: outcome.asOf,
    tenantId: tenantOfRecord(outcome),
    projectId: outcome.project,
    agent: null,
    capability: null,
    evidenceConsulted: outcome.evidence,
    proposal: outcome.decision.intentRef,
    challenge: null,
    riskChecks: [],
    decision: { kind: 'observed', ref: outcome.decision.decisionRef },
  };
  return event;
}

/**
 * Watch event from a post-mortem: the challenge lens carries the
 * leading hypothesis class (the adversarial challenge the
 * post-mortem examined), the evidence lens the post-mortem's
 * evidence refs. Hypothesis details/notes NEVER enter the watch
 * surface (the firewall plus the closed shape).
 */
export function watchEventFromPostMortem(scope: WorkspaceScope, postMortem: PostMortemRecord): WatchEvent {
  assertProjectScope(scope, { tenant: postMortem.lineage.tenant, project: postMortem.lineage.project });
  assertNoReasoningText({ subject: postMortem.subject, evidence: postMortem.evidence, hypotheses: postMortem.hypotheses.map((h) => ({ class: h.class, confidence: h.confidence })) }, 'postMortemRecord');
  const event: WatchEvent = {
    at: postMortem.asOf,
    tenantId: postMortem.lineage.tenant,
    projectId: postMortem.lineage.project,
    agent: null,
    capability: null,
    evidenceConsulted: postMortem.evidence,
    proposal: postMortem.subject.decisionRef,
    challenge: postMortem.hypotheses.length > 0 ? (postMortem.hypotheses[0] as { class: string }).class : null,
    riskChecks: [],
    decision: { kind: 'observed', ref: postMortem.subject.decisionRef },
  };
  return event;
}
