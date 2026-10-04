// deploy/adapters/resend/resend.test.ts — the Resend adapter tests
// (T052, W-3c).
//
// ALL OFFLINE: a fake Resend REST responder behind an injected fetch —
// NO live calls, NO real keys (FIXED FAKE values). What is pinned:
//   1. request-construction determinism (URL, Bearer header, body bytes);
//   2. the EIGHT UX.md notice types as typed template records — the
//      kind list is pinned against the REAL console table test-only
//      (the interop trip-wire: drift in apps/web's notice kinds fails
//      here);
//   3. template determinism: the same notice renders byte-identical
//      subject/text/html;
//   4. L12: the delivery lane refuses a cross-tenant notice; the
//      delivery history is tenant-scoped;
//   5. R46: unreachable / HTTP error / malformed body are typed
//      failures — never a throw.

import { describe, expect, it } from 'vitest';
import { NOTICE_KINDS as REAL_NOTICE_KINDS, NOTICE_TITLES as REAL_NOTICE_TITLES } from '../../../apps/web/src/core/notices';
import { buildResendRequest, sendEmail, type OutboundEmail, type ResendConfig } from './client';
import { NOTICE_KINDS, NOTICE_TEMPLATES, ResendNoticeDelivery, renderHtmlBody, renderSubject, renderTextBody, type NoticeRecordMirror } from './templates';
import type { FetchLike, InstantSourceMirror } from '../shared';

// ---------------------------------------------------------------------------
// The fixed FAKE configuration (never a real key)
// ---------------------------------------------------------------------------

const FAKE_CONFIG: ResendConfig = {
  apiKey: 're_fake_api_key_demo_not_real',
  from: 'TradRL Console <console@demo.tradrl.example>',
};

const instants: InstantSourceMirror = (() => {
  let cursor = 0;
  return { next: () => 1_800_300_000_000 + cursor++ };
})();

// ---------------------------------------------------------------------------
// 1. Request-construction determinism
// ---------------------------------------------------------------------------

describe('deploy/adapters/resend — the client request determinism', () => {
  it('the send request is byte-pinned: POST https://api.resend.com/emails, Bearer key, JSON body', () => {
    const email: OutboundEmail = { to: ['operator@example.org'], subject: 'TradRL: Training milestone — project prj_demo', text: 'A training run reached a milestone.' };
    const request = buildResendRequest(FAKE_CONFIG, email);
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api.resend.com/emails');
    expect(request.headers.authorization).toBe('Bearer re_fake_api_key_demo_not_real');
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.body).toBe('{"from":"TradRL Console <console@demo.tradrl.example>","to":["operator@example.org"],"subject":"TradRL: Training milestone — project prj_demo","text":"A training run reached a milestone."}');
  });

  it('html + cc ride the body when present; identical inputs -> identical bytes (L9)', () => {
    const email: OutboundEmail = { to: ['a@example.org'], cc: ['b@example.org'], subject: 's', text: 't', html: '<p>t</p>' };
    const a = buildResendRequest(FAKE_CONFIG, email);
    const b = buildResendRequest(FAKE_CONFIG, email);
    expect(a.body).toBe(b.body);
    expect(a.body).toContain('"html":"<p>t</p>"');
    expect(a.body).toContain('"cc":["b@example.org"]');
  });
});

// ---------------------------------------------------------------------------
// 2 + 3. The eight notice types + template determinism
// ---------------------------------------------------------------------------

describe('deploy/adapters/resend — the eight UX.md notice templates', () => {
  it('the kind list is pinned against the REAL console table (the interop trip-wire)', () => {
    expect([...NOTICE_KINDS]).toEqual([...REAL_NOTICE_KINDS]);
    // Every kind has a template; every template's kind round-trips.
    for (const kind of NOTICE_KINDS) {
      expect(NOTICE_TEMPLATES[kind].kind).toBe(kind);
      expect(NOTICE_TEMPLATES[kind].subject.length).toBeGreaterThan(0);
      expect(NOTICE_TEMPLATES[kind].lead.length).toBeGreaterThan(0);
    }
    // The subjects track the UX charter's own event names (the console's titles).
    expect(NOTICE_TEMPLATES.organization_compiled.subject).toContain(REAL_NOTICE_TITLES.organization_compiled);
    expect(NOTICE_TEMPLATES.safety_intervention.subject).toContain(REAL_NOTICE_TITLES.safety_intervention);
  });

  it('the same notice renders byte-identical subject + text + html (L9 determinism)', () => {
    const notice = noticeOf('training_milestone', [
      { label: 'job', value: 'job_research_001' },
      { label: 'kind', value: 'research' },
    ]);
    expect(renderSubject(notice)).toBe(renderSubject(notice));
    expect(renderTextBody(notice)).toBe(renderTextBody(notice));
    expect(renderHtmlBody(notice)).toBe(renderHtmlBody(notice));
    // A different notice (different facts) renders differently.
    const other = noticeOf('training_milestone', [{ label: 'job', value: 'job_other_002' }, { label: 'kind', value: 'research' }]);
    expect(renderTextBody(other)).not.toBe(renderTextBody(notice));
  });

  it('the pinned text body: lead + project + facts + provenance + ISO instant (plain language, values verbatim)', () => {
    const notice = noticeOf('safety_intervention', [
      { label: 'submission', value: 'gwys:abc123' },
      { label: 'stage', value: 'risk-gate' },
    ]);
    const body = renderTextBody(notice);
    expect(body).toContain('A safety intervention stopped a submission for your project.');
    expect(body).toContain('Project: prj_demo');
    expect(body).toContain('submission: gwys:abc123');
    expect(body).toContain('stage: risk-gate');
    expect(body).toContain('Source: /v1/execution/requests — gwys:abc123');
    expect(body).toContain('Recorded at: 2026-09-17T');
    expect(body).toContain('The TradRL Console');
  });

  it('the HTML body escapes hostile fact values (no markup injection)', () => {
    const hostile = noticeOf('capability_gap', [{ label: 'knowledge', value: '<script>alert(1)</script>' }]);
    const html = renderHtmlBody(hostile);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('all eight kinds render (the battery — no kind throws, every subject carries the project)', () => {
    for (const kind of NOTICE_KINDS) {
      const notice = noticeOf(kind, [{ label: 'ref', value: 'x' }]);
      expect(renderSubject(notice)).toContain('prj_demo');
      expect(renderTextBody(notice).length).toBeGreaterThan(50);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. L12 + the delivery flow; 5. R46 degradation
// ---------------------------------------------------------------------------

describe('deploy/adapters/resend — the delivery lane', () => {
  it('a notice from ANOTHER tenant is refused (typed cross-tenant refusal — L12)', async () => {
    const fake = fakeResend();
    const delivery = new ResendNoticeDelivery({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const foreign = noticeOf('training_milestone', [], 'tenant-other');
    const result = await delivery.deliver('tenant-a', foreign, 'operator@example.org');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('another tenant');
    expect(fake.calls.length).toBe(0); // never even sent
  });

  it('deliver -> the tenant-scoped delivery record + history; same notice+tenant replays the same subject', async () => {
    const fake = fakeResend();
    const delivery = new ResendNoticeDelivery({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const notice = noticeOf('organization_compiled', [
      { label: 'organization', value: 'org:compiled-1' },
      { label: 'status', value: 'active' },
      { label: 'instances', value: '12' },
    ]);
    const delivered = await delivery.deliver('tenant-a', notice, 'operator@example.org');
    expect(delivered.ok).toBe(true);
    expect(fake.calls.length).toBe(1);
    const call = fake.calls[0];
    if (call === undefined) throw new Error('no call');
    expect(call.url).toBe('https://api.resend.com/emails');
    expect(call.body).toContain('"subject":"TradRL: Organization compiled — project prj_demo"');
    expect(delivery.deliveriesOf('tenant-a').length).toBe(1);
    expect(delivery.deliveriesOf('tenant-b').length).toBe(0); // L12 read-side scoping
  });

  it('R46: unreachable / HTTP error / malformed body are typed failures — never a throw', async () => {
    const failing: FetchLike = async () => {
      throw new Error('connection refused (simulated)');
    };
    const delivery = new ResendNoticeDelivery({ config: FAKE_CONFIG, fetchLike: failing, instants });
    const unreachable = await delivery.deliver('tenant-a', noticeOf('failed_evaluation', []), 'operator@example.org');
    expect(unreachable.ok).toBe(false);
    if (unreachable.ok) return;
    expect(unreachable.error.code).toBe('resend_unreachable');
    const http402: FetchLike = async () => ({ ok: false, status: 402, text: async () => '{"message":"quota exceeded"}' });
    const quota = await new ResendNoticeDelivery({ config: FAKE_CONFIG, fetchLike: http402, instants }).deliver('tenant-a', noticeOf('failed_evaluation', []), 'operator@example.org');
    expect(quota.ok).toBe(false);
    if (quota.ok) return;
    expect(quota.error.code).toBe('resend_http_error');
    expect(quota.error.message).toContain('402');
    const malformed: FetchLike = async () => ({ ok: true, status: 200, text: async () => 'not json' });
    const broken = await sendEmail(FAKE_CONFIG, { to: ['x@y'], subject: 's', text: 't' }, malformed);
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.error.code).toBe('resend_malformed_response');
  });

  it('a successful send returns the provider email id', async () => {
    const fake = fakeResend();
    const sent = await sendEmail(FAKE_CONFIG, { to: ['x@y'], subject: 's', text: 't' }, fake.fetchLike);
    expect(sent).toEqual({ ok: true, value: 'email_fake_1' });
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function noticeOf(kind: NoticeRecordMirror['kind'], facts: readonly { label: string; value: string }[], tenant = 'tenant-a'): NoticeRecordMirror {
  return {
    noticeId: `ntc:${kind}`,
    kind,
    tenantId: tenant,
    projectId: 'prj_demo',
    at: Date.UTC(2026, 8, 17, 10, 30, 0),
    source: { route: '/v1/execution/requests', ref: facts[0]?.value ?? 'ref:1' },
    title: NOTICE_TEMPLATES[kind].subject.replace('TradRL: ', ''),
    facts,
  };
}

function fakeResend(): { fetchLike: FetchLike; calls: { url: string; body: string }[] } {
  const calls: { url: string; body: string }[] = [];
  let idCursor = 0;
  const fetchLike: FetchLike = async (url, init) => {
    calls.push({ url, body: init?.body ?? '' });
    idCursor += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: `email_fake_${idCursor}` }) };
  };
  return { fetchLike, calls };
}
