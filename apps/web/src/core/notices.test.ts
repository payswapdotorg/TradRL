// Tests for the notice fold — the eight UX.md event types as typed records.
//
// Laws pinned here (notices.ts header):
//   - exactly the eight charter event types, in charter order;
//   - the fold is PURE, DETERMINISTIC and IDEMPOTENT: same reads ->
//     identical notice bytes, in a total order (at, then noticeId);
//   - every notice id is content-addressed (same signal -> same id);
//   - the inbox: unread state, idempotent merge (no doubling, reads
//     preserved), mark-one/mark-all;
//   - L12: a foreign tenant's reads never fold (typed CrossTenantRenderError).

import { describe, expect, it } from 'vitest';
import type { GatewaySubmissionRecord, JobRecord, OrgStatusSnapshot, OutcomeRecord, PriceAlertRecord, ProjectRecord, ServedKnowledge } from '../api/contracts';
import {
  NOTICE_FACT_LABELS,
  NOTICE_KINDS,
  NOTICE_READ_STORAGE_KEY,
  NOTICE_TITLES,
  emptyInbox,
  foldNotices,
  isNoticeKind,
  markAllNoticesRead,
  markNoticeRead,
  mergeNotices,
  noticeReadKey,
  parseStoredNoticeReads,
  scopedInbox,
  serializeNoticeReads,
  storedReadNoticeIds,
  unreadCount,
  unreadCountAt,
  unreadNotices,
  type InboxState,
  type NoticeReads,
  type NoticeRecord,
} from './notices';
import { CrossTenantRenderError } from './errors';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
const T0 = 1_700_000_000_000;

function completedProject(): ProjectRecord {
  return {
    id: 'proj-a', tenantId: 'tenant-a', name: 'P', executionMode: 'simulation',
    lifecycle: { projectId: 'proj-a', status: 'completed', acceptanceCriteriaId: 'ac-1', organizationRef: 'org:alpha' },
    createdAt: T0, updatedAt: T0 + 50,
  } as unknown as ProjectRecord;
}

function activeOrg(): OrgStatusSnapshot {
  return { organizationRef: 'org:alpha', tenant: 'tenant-a', project: 'proj-a', status: 'active', at: T0 + 10, instanceRefs: ['i1', 'i2', 'i3'] };
}

function job(kind: 'research' | 'learning', status: 'complete' | 'failed', result?: unknown, at = T0 + 20): JobRecord {
  return { jobId: `job-${kind}-${status}`, kind, tenant: 'tenant-a', project: 'proj-a', status, submittedAt: at, ...(result === undefined ? {} : { result }), ...(status === 'complete' ? { completedAt: at + 5 } : {}) };
}

function decayedKnowledge(): ServedKnowledge {
  return {
    record: {
      knowledgeId: 'knl-1', ordinal: 1, tenant: 'tenant-a', project: 'proj-a',
      claim: { kind: 'causal', polarity: 'positive', dimension: 'momentum', lagBand: null },
      confidence: '0.80', evidenceCount: 2,
      provenance: { postMortemRefs: [], outcomeRefs: [], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: [] },
      validity: { from: T0, to: T0 + 1000 }, asOf: T0 + 25, priorChainHead: '00000000',
    },
    status: 'decayed', supersededBy: null,
  } as unknown as ServedKnowledge;
}

function shadowDegradedOutcome(): OutcomeRecord {
  return {
    outcomeId: 'out-1', ordinal: 1, tenant: 'tenant-a', project: 'proj-a',
    decision: { decisionRef: 'dec-1', intentRef: 'int-1', disposition: 'filled' },
    outcomeClass: 'realized-profit',
    expectation: { expectedQuantity: '10', expectedRealized: '1.5', tolerance: '0.25', declaredBy: 'b1' },
    realization: { filledQuantity: '10', realizedOutcome: '0.50', feeTotal: '0.02', notionalTotal: '1000.00', unrealizedAtDecision: '0.00' },
    deviation: { quantityShortfall: null, realizedGap: '1.00', withinTolerance: false },
    evidence: [], lineage: { shadow: { fidelity: { mode: 'shadow' } } },
    asOf: T0 + 30, priorChainHead: '00000000',
  } as unknown as OutcomeRecord;
}

function refusedSubmission(): GatewaySubmissionRecord {
  return { kind: 'refused', submissionId: 'sub-1', decisionId: null, auditId: 'aud-1', refusal: { stage: 'risk-policy' }, refusedAt: T0 + 40 };
}

/** The reads carrying one signal for each of the eight kinds. */
function allEightReads(): NoticeReads {
  return {
    project: completedProject(),
    orgSnapshots: [activeOrg()],
    jobs: [job('learning', 'complete'), job('research', 'failed'), job('research', 'complete', { kind: 'release-candidate' })],
    knowledge: [decayedKnowledge()],
    outcomes: [shadowDegradedOutcome()],
    submissions: [refusedSubmission()],
  };
}

describe('notices: the eight UX.md event types + the FW-53 alert_fired extension', () => {
  it('is exactly the eight charter kinds + the FW-53 alert_fired extension at the tail, in charter order', () => {
    expect([...NOTICE_KINDS]).toEqual([
      'organization_compiled', 'training_milestone', 'failed_evaluation', 'capability_gap',
      'release_candidate', 'acceptance_criteria_met', 'shadow_degradation', 'safety_intervention',
      'alert_fired',
    ]);
    expect(NOTICE_KINDS).toHaveLength(9);
  });

  it('isNoticeKind admits exactly the nine', () => {
    for (const kind of NOTICE_KINDS) expect(isNoticeKind(kind)).toBe(true);
    for (const bad of ['training', 'Training Milestone', '', 'misc', 42]) expect(isNoticeKind(bad), JSON.stringify(bad)).toBe(false);
  });

  it('every kind has its charter title and a closed fact-label table', () => {
    expect(NOTICE_TITLES.organization_compiled).toBe('Organization compiled');
    expect(NOTICE_TITLES.safety_intervention).toBe('Safety intervention');
    expect(NOTICE_TITLES.alert_fired).toBe('Alert fired');
    for (const kind of NOTICE_KINDS) {
      expect(NOTICE_TITLES[kind].length).toBeGreaterThan(0);
      expect(NOTICE_FACT_LABELS[kind].length).toBeGreaterThan(0);
    }
  });

  it('the fold derives one notice per carried signal — all eight charter kinds at once (no alerts in this fixture; alert_fired folds only when alerts + crossing fills exist)', () => {
    const folded = foldNotices(SCOPE, allEightReads());
    const kinds = folded.map((notice) => notice.kind);
    expect(new Set(kinds)).toEqual(new Set(NOTICE_KINDS.filter((kind) => kind !== 'alert_fired')));
    expect(folded).toHaveLength(8);
  });

  it('every notice is typed, scoped, provenance-carrying and availability-stamped', () => {
    const folded = foldNotices(SCOPE, allEightReads());
    for (const notice of folded) {
      expect(notice.noticeId).toMatch(/^ntc:[0-9a-f]{8}$/);
      expect(notice.tenantId).toBe('tenant-a');
      expect(notice.projectId).toBe('proj-a');
      expect(notice.source.route).toMatch(/^\/v1\//);
      expect(notice.source.ref.length).toBeGreaterThan(0);
      expect(Number.isInteger(notice.at)).toBe(true);
      expect(notice.title).toBe(NOTICE_TITLES[notice.kind]);
    }
  });

  it('the derivation map is faithful: each read signal folds to its charter kind', () => {
    const folded = foldNotices(SCOPE, allEightReads());
    const byKind = new Map(folded.map((notice) => [notice.kind, notice]));
    expect(byKind.get('organization_compiled')?.source.route).toBe('/v1/organizations/:ref/status');
    expect(byKind.get('training_milestone')?.facts.map((f) => f.label)).toEqual(['job', 'kind']);
    expect(byKind.get('capability_gap')?.facts.map((f) => f.value)).toContain('0.80');
    // N-3: the safety_intervention notice now carries the trading-halt fact (paused when no newer routed fill exists — the desk is still halted).
    expect(byKind.get('safety_intervention')?.facts.map((f) => f.label)).toEqual(['submission', 'stage', 'trading-halt']);
    expect(byKind.get('safety_intervention')?.facts.map((f) => f.value)).toContain('paused');
    expect(byKind.get('shadow_degradation')?.facts.map((f) => f.value)).toContain('1.00'); // the realized gap, verbatim decimal
    expect(byKind.get('acceptance_criteria_met')?.at).toBe(T0 + 50); // the project read's availability
  });

  it('quiet reads fold to NOTHING (no invented notices)', () => {
    const folded = foldNotices(SCOPE, { jobs: [job('research', 'complete', { kind: 'other-marker' })] });
    expect(folded).toEqual([]);
    expect(foldNotices(SCOPE, {})).toEqual([]);
    expect(foldNotices(SCOPE, { orgSnapshots: [{ ...activeOrg(), status: 'forming' as never }] })).toEqual([]);
  });
});

describe('notices: fold DETERMINISM + IDEMPOTENCE (the demanded pin)', () => {
  it('same reads -> identical folded bytes, in a total order (at, then noticeId)', () => {
    const first = JSON.stringify(foldNotices(SCOPE, allEightReads()));
    const second = JSON.stringify(foldNotices(SCOPE, allEightReads()));
    expect(second).toBe(first);

    const folded = foldNotices(SCOPE, allEightReads());
    const ordered = [...folded].sort((a, b) => (a.at === b.at ? (a.noticeId < b.noticeId ? -1 : 1) : a.at - b.at));
    expect(folded.map((n) => n.noticeId)).toEqual(ordered.map((n) => n.noticeId));
  });

  it('the id is content-addressed: the same signal re-folds to the SAME id', () => {
    const first = foldNotices(SCOPE, { jobs: [job('learning', 'complete')] });
    const second = foldNotices(SCOPE, { jobs: [job('learning', 'complete')] });
    expect(first[0]?.noticeId).toBe(second[0]?.noticeId);
  });

  it('read ORDER does not change the folded order (the fold sorts, never inherits)', () => {
    const reads = allEightReads();
    const reversed: NoticeReads = { ...reads, jobs: [...(reads.jobs ?? [])].reverse(), orgSnapshots: [...(reads.orgSnapshots ?? [])].reverse() };
    expect(JSON.stringify(foldNotices(SCOPE, reversed))).toBe(JSON.stringify(foldNotices(SCOPE, reads)));
  });
});

describe('notices: the inbox (unread state)', () => {
  function inboxWithTwo(): InboxState {
    return mergeNotices(emptyInbox(), foldNotices(SCOPE, { jobs: [job('learning', 'complete', undefined, T0 + 20), job('research', 'failed', undefined, T0 + 30)] }));
  }

  it('freshly folded notices are unread; count follows', () => {
    const inbox = inboxWithTwo();
    expect(unreadCount(inbox)).toBe(2);
    expect(unreadNotices(inbox)).toHaveLength(2);
  });

  it('markNoticeRead is idempotent and preserves the folded order', () => {
    let inbox = inboxWithTwo();
    const firstId = inbox.notices[0]?.noticeId as string;
    inbox = markNoticeRead(inbox, firstId);
    const again = markNoticeRead(inbox, firstId);
    expect(again).toEqual(inbox); // idempotent
    expect(unreadCount(inbox)).toBe(1);
    expect(unreadNotices(inbox).map((n) => n.noticeId)).not.toContain(firstId);
  });

  it('markAllNoticesRead empties the unread set, idempotently', () => {
    let inbox = markAllNoticesRead(inboxWithTwo());
    expect(unreadCount(inbox)).toBe(0);
    inbox = markAllNoticesRead(inbox);
    expect(unreadCount(inbox)).toBe(0);
  });

  it('mergeNotices is idempotent by content-addressed id (a re-fold never doubles) and preserves reads', () => {
    const base = inboxWithTwo();
    const readId = base.notices[0]?.noticeId as string;
    const readOnce = markNoticeRead(base, readId);
    const refolded = foldNotices(SCOPE, { jobs: [job('learning', 'complete', undefined, T0 + 20), job('research', 'failed', undefined, T0 + 30)] });
    const merged = mergeNotices(readOnce, refolded);
    expect(merged.notices).toHaveLength(2); // no doubling
    expect(unreadCount(merged)).toBe(1); // the read state survived the re-fold
    expect(mergeNotices(merged, refolded)).toEqual(merged);
  });

  it('mergeNotices keeps the total deterministic order across merges', () => {
    const early = foldNotices(SCOPE, { jobs: [job('research', 'failed', undefined, T0 + 100)] });
    const late = foldNotices(SCOPE, { jobs: [job('research', 'failed', undefined, T0 + 10)] });
    const merged = mergeNotices(mergeNotices(emptyInbox(), early), late);
    expect(merged.notices.map((n) => n.at)).toEqual([T0 + 10, T0 + 100]); // sorted by at, not arrival
  });
});

describe('notices: FW-40-B (Round H register H-6) — the VIEW-PROJECTED unread count (one source of truth)', () => {
  /** Two notices: a training milestone at T0+20 and a failed evaluation at T0+30 (both unread). */
  function inboxWithTwo(): InboxState {
    return mergeNotices(emptyInbox(), foldNotices(SCOPE, { jobs: [job('learning', 'complete', undefined, T0 + 20), job('research', 'failed', undefined, T0 + 30)] }));
  }

  it('at the LIVE edge (every notice available) the projected count IS the plain count — the badge, the tile and the header never change at live', () => {
    const inbox = inboxWithTwo();
    expect(unreadCountAt(inbox, T0 + 1000)).toBe(2);
    expect(unreadCountAt(inbox, T0 + 1000)).toBe(unreadCount(inbox)); // identical at live — the pre-fix surfaces' own law, preserved
  });

  it('at a view instant BEFORE a notice\'s availability, the projected count EXCLUDES it (H-6: the counter surfaces and the list surfaces ride ONE fold — never badge 4 over an empty inbox)', () => {
    const inbox = inboxWithTwo();
    expect(unreadCountAt(inbox, T0 + 25)).toBe(1); // the T0+20 notice counts; the T0+30 notice is not yet knowable
    expect(unreadCountAt(inbox, T0 + 10)).toBe(0); // nothing is knowable yet
  });

  it('mark-read reconciles inside the projected count too (a read notice never counts at any instant)', () => {
    const inbox = inboxWithTwo();
    const firstId = inbox.notices[0]?.noticeId as string; // the T0+20 notice
    const readOnce = markNoticeRead(inbox, firstId);
    expect(unreadCountAt(readOnce, T0 + 1000)).toBe(1); // at live: the unread T0+30 notice counts
    expect(unreadCountAt(readOnce, T0 + 25)).toBe(0); // the only VISIBLE notice (T0+20) is read; the T0+30 one is beyond the view
    const secondId = (readOnce.notices.find((n) => n.noticeId !== firstId) as NoticeRecord).noticeId;
    const bothRead = markNoticeRead(readOnce, secondId);
    expect(unreadCountAt(bothRead, T0 + 1000)).toBe(0);
  });
});

describe('notices: L12 — cross-tenant reads never fold', () => {
  it('a foreign tenant record in the reads is the typed CrossTenantRenderError', () => {
    const foreign = { ...allEightReads(), project: { ...(completedProject() as object), tenantId: 'tenant-b' } as unknown as ProjectRecord };
    expect(() => foldNotices(SCOPE, foreign)).toThrow(CrossTenantRenderError);
    const foreignJob = { jobs: [{ ...job('learning', 'complete'), tenant: 'tenant-b' }] };
    expect(() => foldNotices(SCOPE, foreignJob)).toThrow(CrossTenantRenderError);
  });
});

// ---------------------------------------------------------------------------
// D-13 (W-29) — THE PROJECT-SCOPED INBOX VIEW. The inbox STATE keeps every
// notice the session folded (append-only — a scope switch never un-happens
// a notice), but the inbox SURFACE is project-scoped like every section
// panel: a multi-desk tenant never sees the demo project's seed notices
// inside their own desk's inbox (M4/M5/L5: 7 unread = 5 demo + 2 own).
// ---------------------------------------------------------------------------

describe('notices: D-13 — the project-scoped inbox view', () => {
  const SCOPE_B = { tenantId: 'tenant-a', projectId: 'proj-b' } as const;

  /** An inbox carrying one notice for EACH of two desks (the multi-desk tenant). */
  function twoDeskInbox(): InboxState {
    const deskA = foldNotices(SCOPE, { jobs: [job('learning', 'complete', undefined, T0 + 20)] });
    const deskB = foldNotices(SCOPE_B, { jobs: [{ ...job('research', 'failed', undefined, T0 + 30), jobId: 'job-desk-b', project: 'proj-b' }] });
    return mergeNotices(mergeNotices(emptyInbox(), deskA), deskB);
  }

  it('the scoped view lists ONLY the scope\'s own notices — cross-project notices never render in another desk\'s inbox', () => {
    const inbox = twoDeskInbox();
    expect(inbox.notices).toHaveLength(2); // the STATE keeps both desks' notices (append-only)
    const viewA = scopedInbox(inbox, SCOPE);
    expect(viewA.notices).toHaveLength(1);
    expect(viewA.notices[0]?.projectId).toBe('proj-a');
    const viewB = scopedInbox(inbox, SCOPE_B);
    expect(viewB.notices).toHaveLength(1);
    expect(viewB.notices[0]?.projectId).toBe('proj-b');
  });

  it('the scoped view\'s read marks apply to exactly the notices it lists (a foreign mark never leaks in)', () => {
    let inbox = twoDeskInbox();
    const deskAId = scopedInbox(inbox, SCOPE).notices[0]?.noticeId as string;
    inbox = markNoticeRead(inbox, deskAId); // desk A's notice marked read while viewing desk A
    const viewB = scopedInbox(inbox, SCOPE_B);
    expect(viewB.readNoticeIds).toHaveLength(0);       // desk B's view carries no marks
    expect(unreadCount(viewB)).toBe(1);                // desk B's own notice stays unread
    const viewA = scopedInbox(inbox, SCOPE);
    expect(unreadCount(viewA)).toBe(0);                // desk A's view shows its read notice
  });

  it('markAllNoticesRead WITH a scope marks exactly that scope\'s notices — the other desk keeps its unread state (and the unscoped call keeps the pre-D-13 behavior)', () => {
    const inbox = twoDeskInbox();
    const scoped = markAllNoticesRead(inbox, SCOPE_B); // "Mark all read" pressed on desk B's inbox
    expect(unreadCount(scopedInbox(scoped, SCOPE_B))).toBe(0); // desk B's notice is read
    expect(unreadCount(scopedInbox(scoped, SCOPE))).toBe(1);   // desk A's notice KEEPS its unread state
    // the unscoped call marks everything (the pre-D-13 behavior, preserved)
    const all = markAllNoticesRead(scoped);
    expect(unreadCount(all)).toBe(0);
    // idempotent in both shapes
    expect(markAllNoticesRead(markAllNoticesRead(inbox, SCOPE_B), SCOPE_B)).toEqual(markAllNoticesRead(inbox, SCOPE_B));
  });

  it('every one of the nine kinds folds from PROJECT-SCOPED reads — no legitimately tenant-wide notice class exists to disclose (the audit behind the filter)', () => {
    // The fold's every record family passes assertProjectScope (pinned by
    // the L12 tests above), and every notice carries the fold scope's own
    // project stamp — so the project filter drops NOTHING that a desk was
    // ever entitled to see. Should a tenant-level system notice class ever
    // be added, it must carry an explicit scope marker and the view must
    // disclose it (notices.ts's scopedInbox docblock carries the law).
    // N-1: alert_fired is also project-scoped — the alert's own tenant/project
    // and the routed fill's own tenant/project both pass assertProjectScope
    // inside the fold (the firing fold iterates alerts + submissions, both
    // project-scoped records).
    const folded = foldNotices(SCOPE, allEightReads());
    expect(folded).toHaveLength(8);
    for (const notice of folded) {
      expect(notice.projectId).toBe(SCOPE.projectId); // every kind is project-labeled
      expect(scopedInbox({ notices: folded, readNoticeIds: [] }, SCOPE).notices).toContain(notice);
      expect(scopedInbox({ notices: folded, readNoticeIds: [] }, SCOPE_B).notices).not.toContain(notice);
    }
  });
});

// ---------------------------------------------------------------------------
// N-1 (Round P — fired alerts never reach the Inbox, S3): the alert_fired
// fold. S3 scored notifications 2/10: "a part-time operator can't rely on
// a console whose fired alerts never reach the Inbox". The fold's eight
// charter kinds never included a price-alert firing — the alerts-card's
// FIRED verdict rendered in the Market World section but never reached
// the notices fold. THE LAW: a fired alert folds to one Inbox notice per
// firing, availability-stamped at the firing observation's OWN instant
// (L4 — the fill's filledAt), provenance-carrying (the alert's alertId),
// idempotent (the same alert + the same observations re-fold to the same
// noticeId). An alert with no crossing observation stays WAITING — never
// a fabricated firing (the same law the alerts-card rides).
// ---------------------------------------------------------------------------

describe('notices: N-1 — fired alerts reach the Inbox (the alert_fired fold)', () => {
  /** A price alert declared on the project's goal bundle (FW-46). */
  function priceAlert(alertId: string, market: string, direction: 'above' | 'below', level: string, declaredAt: number, opts: { tenant?: string; project?: string } = {}): PriceAlertRecord {
    return {
      alertId,
      tenant: opts.tenant ?? 'tenant-a',
      project: opts.project ?? 'proj-a',
      declaredAt,
      market,
      direction,
      level,
    } as unknown as PriceAlertRecord;
  }

  /** A routed submission with a fill that crosses an alert's level. */
  function filledSubmission(submissionId: string, instrument: string, price: string, routedAt: number, filledAt: number): GatewaySubmissionRecord {
    return {
      kind: 'routed',
      submissionId,
      decisionId: `dec-${submissionId}`,
      auditId: `aud-${submissionId}`,
      requestRef: `req-${submissionId}`,
      venue: 'venue-x',
      adapterRef: 'adp-1',
      channelRef: 'ch-1',
      routedAt,
      order: { instrumentId: instrument, side: 'buy', quantity: '1' },
      fill: { price, quantity: '1', filledAt },
    } as unknown as GatewaySubmissionRecord;
  }

  it('a fired alert folds to one Inbox notice, availability-stamped at the firing observation\'s OWN instant (the fill\'s filledAt, L4)', () => {
    const alert = priceAlert('alert:aaaa1111', 'BTC-USD', 'above', '61000', T0 + 40);
    const submission = filledSubmission('sub-1', 'BTC-USD', '62000.00', T0 + 50, T0 + 60); // fills at +60 above the level
    const folded = foldNotices(SCOPE, { alerts: [alert], submissions: [submission] });
    expect(folded).toHaveLength(1);
    expect(folded[0]?.kind).toBe('alert_fired');
    expect(folded[0]?.at).toBe(T0 + 60); // the firing observation's OWN instant (L4)
    expect(folded[0]?.source.route).toBe('/v1/projects/:id/goal');
    expect(folded[0]?.source.ref).toBe('alert:aaaa1111');
    expect(folded[0]?.title).toBe('Alert fired');
  });

  it('the firing notice carries the alert\'s own envelope (market/direction/level) + the observed price that crossed the level (verbatim decimal — the same value the alerts-card renders)', () => {
    const alert = priceAlert('alert:aaaa1111', 'BTC-USD', 'above', '61000', T0 + 40);
    const submission = filledSubmission('sub-1', 'BTC-USD', '62000.00', T0 + 50, T0 + 60);
    const folded = foldNotices(SCOPE, { alerts: [alert], submissions: [submission] });
    const facts = folded[0]?.facts.map((f) => `${f.label}=${f.value}`);
    expect(facts).toEqual([
      'alert=alert:aaaa1111',
      'market=BTC-USD',
      'direction=above',
      'level=61000',
      'observed-price=62000.00',
    ]);
  });

  it('an alert with NO crossing observation stays WAITING — never a fabricated firing notice (the same law the alerts-card rides)', () => {
    const alert = priceAlert('alert:aaaa1111', 'BTC-USD', 'above', '61000', T0 + 40);
    const submission = filledSubmission('sub-1', 'BTC-USD', '50000.00', T0 + 50, T0 + 60); // below the level — never fires
    const folded = foldNotices(SCOPE, { alerts: [alert], submissions: [submission] });
    expect(folded).toEqual([]); // the alert waits — never a fabricated firing notice
  });

  it('the firing notice is idempotent — the same alert + the same observations re-fold to the SAME noticeId (content-addressed)', () => {
    const alert = priceAlert('alert:aaaa1111', 'BTC-USD', 'above', '61000', T0 + 40);
    const submission = filledSubmission('sub-1', 'BTC-USD', '62000.00', T0 + 50, T0 + 60);
    const first = foldNotices(SCOPE, { alerts: [alert], submissions: [submission] });
    const second = foldNotices(SCOPE, { alerts: [alert], submissions: [submission] });
    expect(second[0]?.noticeId).toBe(first[0]?.noticeId);
  });

  it('L12: a foreign-tenant alert reaching the firing fold is the typed CrossTenantRenderError', () => {
    const foreignAlert = priceAlert('alert:foreign', 'BTC-USD', 'above', '61000', T0 + 40, { tenant: 'tenant-b', project: 'proj-b' });
    const submission = filledSubmission('sub-1', 'BTC-USD', '62000.00', T0 + 50, T0 + 60);
    expect(() => foldNotices(SCOPE, { alerts: [foreignAlert], submissions: [submission] })).toThrow(CrossTenantRenderError);
  });
});

// ---------------------------------------------------------------------------
// N-3 (Round P — the silent desk halt, L3 + L1): the safety_intervention
// notice names the refusal AND the desk's halt state. L3: "no notice or
// UI hint that trading paused or when it resumes; my will-fire alert
// stayed waiting 24 min with no explanation". L1: "desks stop at 2 fills,
// nothing in the UI produces post-declaration fills". THE LAW: the halt
// state is computed at fold time: 'paused' when no newer routed submission
// exists after this refusal (the desk is still halted — the will-fire
// alert stays waiting); 'resumed' when a newer routed submission exists
// (the halt was lifted). The honest-posture law (no silent halts) now
// carries into the notice fold itself.
// ---------------------------------------------------------------------------

describe('notices: N-3 — the desk halt state rides the safety_intervention notice (no silent halts)', () => {
  /** A routed submission (a fill) — the "desk resumed" signal. */
  function routedSubmission(submissionId: string, routedAt: number): GatewaySubmissionRecord {
    return {
      kind: 'routed',
      submissionId,
      decisionId: `dec-${submissionId}`,
      auditId: `aud-${submissionId}`,
      requestRef: `req-${submissionId}`,
      venue: 'venue-x',
      adapterRef: 'adp-1',
      channelRef: 'ch-1',
      routedAt,
    } as unknown as GatewaySubmissionRecord;
  }

  /** A refused submission with a given id + instant (the "desk halted" signal). */
  function refusedAt(submissionId: string, refusedAt: number): GatewaySubmissionRecord {
    return {
      kind: 'refused',
      submissionId,
      decisionId: null,
      auditId: `aud-${submissionId}`,
      refusal: { stage: 'risk-policy' },
      refusedAt,
    } as unknown as GatewaySubmissionRecord;
  }

  it('a refusal with NO newer routed submission folds trading-halt=paused — the desk has stopped (L3: "no notice or UI hint that trading paused")', () => {
    const folded = foldNotices(SCOPE, { submissions: [refusedSubmission()] });
    expect(folded).toHaveLength(1);
    const haltFact = folded[0]?.facts.find((f) => f.label === 'trading-halt');
    expect(haltFact?.value).toBe('paused'); // RED pre-fix: the halt state was never surfaced
  });

  it('a refusal WITH a newer routed submission folds trading-halt=resumed — the halt was lifted (L3: "or when it resumes")', () => {
    // refusal at T0+40, then a routed submission at T0+50 — the desk resumed.
    const folded = foldNotices(SCOPE, { submissions: [refusedSubmission(), routedSubmission('sub-routed', T0 + 50)] });
    expect(folded).toHaveLength(1);
    const haltFact = folded[0]?.facts.find((f) => f.label === 'trading-halt');
    expect(haltFact?.value).toBe('resumed'); // the halt was lifted — the desk resumed
  });

  it('the halt state is computed PER-refusal: two refusals + a routed in between fold the first refusal resumed, the second refusal paused', () => {
    // refusal1 @ T0+40, routed @ T0+50 (resume), refusal2 @ T0+60 (halt again).
    const folded = foldNotices(SCOPE, {
      submissions: [
        refusedAt('sub-1', T0 + 40),
        routedSubmission('sub-routed', T0 + 50),
        refusedAt('sub-2', T0 + 60),
      ],
    });
    expect(folded).toHaveLength(2);
    const first = folded.find((n) => n.facts.some((f) => f.label === 'submission' && f.value === 'sub-1'));
    const second = folded.find((n) => n.facts.some((f) => f.label === 'submission' && f.value === 'sub-2'));
    expect(first?.facts.find((f) => f.label === 'trading-halt')?.value).toBe('resumed'); // a newer routed submission exists after sub-1
    expect(second?.facts.find((f) => f.label === 'trading-halt')?.value).toBe('paused'); // no newer routed submission after sub-2
  });

  it('the trading-halt fact is content-addressed into the noticeId — the halt state is part of the notice\'s identity (re-folding the same reads produces the same id)', () => {
    const reads = { submissions: [refusedSubmission()] };
    const first = foldNotices(SCOPE, reads);
    const second = foldNotices(SCOPE, reads);
    expect(second[0]?.noticeId).toBe(first[0]?.noticeId);
  });
});

// ---------------------------------------------------------------------------
// The durable read-state (D-6c, W-25C) — per-browser, per-scope UI state.
// ---------------------------------------------------------------------------

describe('notices: the durable read-state storage shape (D-6c)', () => {
  it('the read key is the full tenant/project/notice triple (the tenant-isolation law carried into the persisted map)', () => {
    expect(NOTICE_READ_STORAGE_KEY).toBe('tradrl_notice_read'); // the documented localStorage key
    expect(noticeReadKey('tenant-a', 'proj-a', 'ntc:abc123')).toBe('tenant-a/proj-a/ntc:abc123');
    expect(noticeReadKey('tenant-b', 'proj-a', 'ntc:abc123')).not.toBe(noticeReadKey('tenant-a', 'proj-a', 'ntc:abc123'));
    expect(noticeReadKey('tenant-a', 'proj-b', 'ntc:abc123')).not.toBe(noticeReadKey('tenant-a', 'proj-a', 'ntc:abc123'));
  });

  it('serialize -> parse round-trips the stored map', () => {
    const reads: Record<string, 1> = { 'tenant-a/proj-a/ntc:one': 1, 'tenant-a/proj-b/ntc:two': 1 };
    expect(parseStoredNoticeReads(serializeNoticeReads(reads))).toEqual(reads);
    expect(parseStoredNoticeReads(null)).toEqual({});
    expect(parseStoredNoticeReads('')).toEqual({});
  });

  it('storage is UNTRUSTED input: garbage, foreign JSON shapes and non-1 marks degrade to the empty map', () => {
    expect(parseStoredNoticeReads('not json at all')).toEqual({});
    expect(parseStoredNoticeReads('[1,2,3]')).toEqual({});
    expect(parseStoredNoticeReads('"a string"')).toEqual({});
    expect(parseStoredNoticeReads('null')).toEqual({});
    expect(parseStoredNoticeReads('{"tenant-a/proj-a/ntc:one": "yes"}')).toEqual({}); // a non-1 mark is not a read mark
    expect(parseStoredNoticeReads('{"tenant-a/proj-a/ntc:one": 1, "junk": 2}')).toEqual({ 'tenant-a/proj-a/ntc:one': 1 }); // the valid mark survives
  });

  it('storedReadNoticeIds selects exactly the notices whose marks the map carries — derived from each record\'s OWN tenant/project', () => {
    const folded = foldNotices(SCOPE, { jobs: [job('research', 'failed', undefined, T0 + 10), job('learning', 'complete', undefined, T0 + 20)] });
    const first = folded[0] as NoticeRecord;
    const second = folded[1] as NoticeRecord;
    // marks for the first notice under ITS OWN scope key, plus a foreign-scope mark that must never match
    const reads: Record<string, 1> = {
      [noticeReadKey(first.tenantId, first.projectId, first.noticeId)]: 1,
      [noticeReadKey(first.tenantId, 'proj-OTHER', first.noticeId)]: 1,
    };
    expect(storedReadNoticeIds(reads, folded)).toEqual([first.noticeId]);
    expect(storedReadNoticeIds({}, folded)).toEqual([]);
    expect(storedReadNoticeIds(reads, [second])).toEqual([]); // the second notice carries no mark
  });
});
