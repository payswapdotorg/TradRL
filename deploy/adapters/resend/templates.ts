// deploy/adapters/resend/templates.ts — the eight UX.md notification
// types as TYPED TEMPLATE RECORDS (T052, W-3c).
//
// The kinds mirror apps/web/src/core/notices.ts's NOTICE_KINDS
// (STRUCTURAL MIRROR — never imported; the contract test in
// resend.test.ts pins the kind list against the REAL table test-only,
// the T041 interop precedent). Every template is PURE: the same notice
// record renders the same subject + the same body bytes (determinism
// pinned). Plain language, no jargon: the subject is the UX charter's
// own event name; the body renders the notice's typed facts as
// "label: value" lines plus the provenance line (which read folded it)
// and the project scope.
//
// Spec anchors: UX.md (the eight notification event types), L9, R45
// (provenance rides every notice), D-033.

// ---------------------------------------------------------------------------
// The notice input shape (mirror of the console's NoticeRecord, delivery side)
// ---------------------------------------------------------------------------

/** The eight UX.md notification event types (mirror — pinned by test). */
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

/** One typed fact rendered inside a notice (label from the closed vocabulary; value verbatim). */
export interface NoticeFactMirror {
  readonly label: string;
  readonly value: string;
}

/** The delivery-side notice record (mirror of the console's fold output). */
export interface NoticeRecordMirror {
  readonly noticeId: string;
  readonly kind: NoticeKind;
  readonly tenantId: string;
  readonly projectId: string;
  readonly at: number;
  readonly source: { readonly route: string; readonly ref: string };
  readonly title: string;
  readonly facts: readonly NoticeFactMirror[];
}

// ---------------------------------------------------------------------------
// The template records (the closed table — one per kind)
// ---------------------------------------------------------------------------

/** One notice template: the subject pattern + the plain-language intro (both deterministic). */
export interface NoticeTemplate {
  readonly kind: NoticeKind;
  /** The email subject (plain language; the project scope rides along). */
  readonly subject: string;
  /** The one-line plain-language lead (what happened). */
  readonly lead: string;
}

/** The closed template table (the UX charter's own event names). */
export const NOTICE_TEMPLATES: Readonly<Record<NoticeKind, NoticeTemplate>> = Object.freeze({
  organization_compiled: { kind: 'organization_compiled', subject: 'TradRL: Organization compiled', lead: 'The organization for your project compiled successfully.' },
  training_milestone: { kind: 'training_milestone', subject: 'TradRL: Training milestone', lead: 'A training run for your project reached a milestone.' },
  failed_evaluation: { kind: 'failed_evaluation', subject: 'TradRL: Failed evaluation', lead: 'An evaluation for your project did not pass.' },
  capability_gap: { kind: 'capability_gap', subject: 'TradRL: Capability gap', lead: 'A knowledge claim surfaced a capability gap for your project.' },
  release_candidate: { kind: 'release_candidate', subject: 'TradRL: Release candidate', lead: 'A run for your project produced a release candidate.' },
  acceptance_criteria_met: { kind: 'acceptance_criteria_met', subject: 'TradRL: Acceptance criteria met', lead: 'Your project met its acceptance criteria.' },
  shadow_degradation: { kind: 'shadow_degradation', subject: 'TradRL: Shadow degradation', lead: 'A shadow outcome for your project degraded beyond its band.' },
  safety_intervention: { kind: 'safety_intervention', subject: 'TradRL: Safety intervention', lead: 'A safety intervention stopped a submission for your project.' },
});

// ---------------------------------------------------------------------------
// The render (pure — byte-deterministic)
// ---------------------------------------------------------------------------

/** Render the email subject for one notice (pure). */
export function renderSubject(notice: NoticeRecordMirror): string {
  const template = NOTICE_TEMPLATES[notice.kind];
  return `${template.subject} — project ${notice.projectId}`;
}

/** Render the plain-text body for one notice (pure: same notice -> same bytes). */
export function renderTextBody(notice: NoticeRecordMirror): string {
  const template = NOTICE_TEMPLATES[notice.kind];
  const lines: string[] = [
    template.lead,
    '',
    `Project: ${notice.projectId}`,
    `Notice: ${notice.title} (${notice.noticeId})`,
    ...notice.facts.map((fact) => `${fact.label}: ${fact.value}`),
    '',
    `Source: ${notice.source.route} — ${notice.source.ref}`,
    `Recorded at: ${new Date(notice.at).toISOString()}`,
    '',
    'You are receiving this because this notice was folded for your project workspace.',
    'The TradRL Console',
  ];
  return lines.join('\n');
}

/** Render the HTML body for one notice (pure; minimal, escaped — the same facts). */
export function renderHtmlBody(notice: NoticeRecordMirror): string {
  const template = NOTICE_TEMPLATES[notice.kind];
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const facts = notice.facts.map((fact) => `      <li><strong>${escape(fact.label)}:</strong> ${escape(fact.value)}</li>`).join('\n');
  return [
    '<html><body style="font-family: system-ui, sans-serif;">',
    '  <p>TradRL Console</p>',
    `  <h2>${escape(template.subject)}</h2>`,
    `  <p>${escape(template.lead)}</p>`,
    `  <p><strong>Project:</strong> ${escape(notice.projectId)}</p>`,
    '  <ul>',
    facts,
    '  </ul>',
    `  <p><small>Source: ${escape(notice.source.route)} — ${escape(notice.source.ref)}</small></p>`,
    '</body></html>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The tenant-scoped delivery record + the delivery flow
// ---------------------------------------------------------------------------

/** One delivery record (tenant-scoped — L12 in the delivery lane). */
export interface DeliveryRecord {
  readonly tenant: string;
  readonly noticeId: string;
  readonly kind: NoticeKind;
  readonly recipient: string;
  readonly subject: string;
  readonly at: number;
}

import { sendEmail, type OutboundEmail, type ResendConfig, type ResendResult } from './client';
import type { FetchLike, InstantSourceMirror } from '../shared';

/** The delivery service: notices -> tenant-scoped emails (R46 degradation; injected instants). */
export class ResendNoticeDelivery {
  private readonly config: ResendConfig;
  private readonly fetchLike: FetchLike;
  private readonly instants: InstantSourceMirror;
  private readonly history: DeliveryRecord[] = [];

  constructor(deps: { readonly config: ResendConfig; readonly fetchLike?: FetchLike; readonly instants: InstantSourceMirror }) {
    this.config = deps.config;
    this.fetchLike = deps.fetchLike ?? ((globalThis as { fetch?: unknown }).fetch instanceof Function ? ((globalThis as { fetch: unknown }).fetch as FetchLike) : (async () => {
      throw new Error('no fetch implementation is available in this runtime');
    }) as FetchLike);
    this.instants = deps.instants;
  }

  /**
   * Deliver one notice to one recipient. The notice's tenantId MUST
   * match the caller's scope tenant — a mismatch is the typed
   * cross_tenant refusal (L12). The delivery record is appended to the
   * per-instance history (tenant-scoped, observable, never secret).
   */
  async deliver(scopeTenant: string, notice: NoticeRecordMirror, recipient: string): Promise<ResendResult<DeliveryRecord>> {
    if (notice.tenantId !== scopeTenant) {
      return { ok: false, error: { code: 'resend_http_error', message: 'the notice belongs to another tenant — refusing the cross-tenant delivery (L12)' } };
    }
    const email: OutboundEmail = {
      to: [recipient],
      subject: renderSubject(notice),
      text: renderTextBody(notice),
      html: renderHtmlBody(notice),
    };
    const sent = await sendEmail(this.config, email, this.fetchLike);
    if (!sent.ok) return sent;
    const record: DeliveryRecord = { tenant: scopeTenant, noticeId: notice.noticeId, kind: notice.kind, recipient, subject: email.subject, at: this.instants.next() };
    this.history.push(record);
    return { ok: true, value: record };
  }

  /** One tenant's delivery records (in delivery order — L12 scoping on the read side). */
  deliveriesOf(tenant: string): readonly DeliveryRecord[] {
    return this.history.filter((record) => record.tenant === tenant);
  }
}
