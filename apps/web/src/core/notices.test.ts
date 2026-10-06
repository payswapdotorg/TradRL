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
import type { GatewaySubmissionRecord, JobRecord, OrgStatusSnapshot, OutcomeRecord, ProjectRecord, ServedKnowledge } from '../api/contracts';
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
  serializeNoticeReads,
  storedReadNoticeIds,
  unreadCount,
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

describe('notices: the eight UX.md event types', () => {
  it('is exactly the eight, in charter order', () => {
    expect([...NOTICE_KINDS]).toEqual([
      'organization_compiled', 'training_milestone', 'failed_evaluation', 'capability_gap',
      'release_candidate', 'acceptance_criteria_met', 'shadow_degradation', 'safety_intervention',
    ]);
    expect(NOTICE_KINDS).toHaveLength(8);
  });

  it('isNoticeKind admits exactly the eight', () => {
    for (const kind of NOTICE_KINDS) expect(isNoticeKind(kind)).toBe(true);
    for (const bad of ['training', 'Training Milestone', '', 'misc', 42]) expect(isNoticeKind(bad), JSON.stringify(bad)).toBe(false);
  });

  it('every kind has its charter title and a closed fact-label table', () => {
    expect(NOTICE_TITLES.organization_compiled).toBe('Organization compiled');
    expect(NOTICE_TITLES.safety_intervention).toBe('Safety intervention');
    for (const kind of NOTICE_KINDS) {
      expect(NOTICE_TITLES[kind].length).toBeGreaterThan(0);
      expect(NOTICE_FACT_LABELS[kind].length).toBeGreaterThan(0);
    }
  });

  it('the fold derives one notice per carried signal — all eight kinds at once', () => {
    const folded = foldNotices(SCOPE, allEightReads());
    const kinds = folded.map((notice) => notice.kind);
    expect(new Set(kinds)).toEqual(new Set(NOTICE_KINDS));
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
    expect(byKind.get('safety_intervention')?.facts.map((f) => f.label)).toEqual(['submission', 'stage']);
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

describe('notices: L12 — cross-tenant reads never fold', () => {
  it('a foreign tenant record in the reads is the typed CrossTenantRenderError', () => {
    const foreign = { ...allEightReads(), project: { ...(completedProject() as object), tenantId: 'tenant-b' } as unknown as ProjectRecord };
    expect(() => foldNotices(SCOPE, foreign)).toThrow(CrossTenantRenderError);
    const foreignJob = { jobs: [{ ...job('learning', 'complete'), tenant: 'tenant-b' }] };
    expect(() => foldNotices(SCOPE, foreignJob)).toThrow(CrossTenantRenderError);
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
