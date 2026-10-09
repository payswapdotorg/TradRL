// Tests for core/oversight.ts — THE CONSOLIDATED MULTI-DESK OVERSIGHT FOLD
// (FW-37-B, Round F register F-2 — every multi-desk persona's #1 ask).
//
// Laws pinned here:
//   - the fold aggregates EVERY session-own desk (+ the shared demo
//     project), NEVER another session's desks (the L12 workspace
//     boundary — the listing the switcher/palette ride since F-3);
//   - per-desk budget rows come from the desk's own standing
//     utilization read (bound + honest current, verbatim — capital and
//     risk first);
//   - L4: every per-desk count is the VIEW-INSTANT projection of the
//     desk's own records (a fill/refusal/decision observed after the
//     view instant never renders; a breach observed after it never
//     counts — the F-6 law, one fold two surfaces);
//   - the honesty law: a desk without a read on record folds to its
//     honest absence (never a fabricated number); "open positions" is
//     never invented — the row carries the blotter's own counts;
//   - the ingest gate (workspace.ts's oversight-read arm): a foreign
//     tenant's decision record is the typed CrossTenantRenderError; a
//     crossed utilization read is refused.

import { describe, expect, it } from 'vitest';
import type { GatewaySubmissionRecord, OutcomeRecord, ProjectRecord, RiskUtilizationRead } from '../api/contracts';
import { CrossTenantRenderError } from './errors';
import { DEMO_PROJECT_ID } from './tenant';
import { formatInstantUtc, parseInstantUtc } from './format';
import { oversightBudgetRowsOf, oversightRowsOf, oversightScopeNoteOf, type OversightDeskRead } from './oversight';
import { openWorkspace, reduceAll, type WorkspaceState } from './workspace';

const T0 = 1_700_000_000_000;
const VIEW_AT = T0 + 10_000;

const project = (id: string, name: string, marker?: 'session-owned' | 'tenant-available'): ProjectRecord => ({
  id, tenantId: 'tenant-a', name, executionMode: 'simulation',
  ...(marker === undefined ? {} : { consoleSessionScope: marker }),
  lifecycle: { projectId: id, status: 'active', acceptanceCriteriaId: null, organizationRef: null },
  lineage: { projectId: id, goal: { goalId: `goal-${id}`, version: 1 }, constraintSet: { id: `cs-${id}`, version: 1 } },
  createdAt: T0, updatedAt: T0,
});

const routedFill = (id: string, at: number): GatewaySubmissionRecord => ({
  kind: 'routed', submissionId: id, decisionId: `xd:${id}`, auditId: `xga:${id}`, requestRef: `gor:${id}`,
  venue: 'binance', adapterRef: 'adapter', channelRef: 'channel', routedAt: at,
  fill: { state: 'filled', quantity: '1', price: '100', notional: '100.00', fee: '0.10', filledAt: at },
});

const refusedRow = (id: string, at: number): GatewaySubmissionRecord => ({
  kind: 'refused', submissionId: id, decisionId: null, auditId: `xga:${id}`,
  refusal: { stage: 'risk_limits', refusals: [{ constraintId: 'k-capital-budget', subject: 'capital.budget', predicate: { kind: 'limit.max', bound: 5000 }, observed: '6000.00' }] },
  refusedAt: at,
});

const decision = (id: string, at: number): OutcomeRecord => ({
  outcomeId: `out:${id}`, ordinal: 1, tenant: 'tenant-a', project: 'prj-a',
  decision: { decisionRef: `xd:${id}`, intentRef: `si:${id}`, disposition: 'filled' },
  outcomeClass: 'entry', expectation: { expectedQuantity: null, expectedRealized: null, tolerance: '0', declaredBy: null },
  realization: { filledQuantity: '1', realizedOutcome: '1.00', feeTotal: '0.10', notionalTotal: '100.00', unrealizedAtDecision: '0' },
  deviation: { quantityShortfall: null, realizedGap: null, withinTolerance: null },
  evidence: [],
  lineage: {
    shadow: { sessionId: 's', fidelity: { mode: 'shadow', fill_origin: 'simulated' }, executionPolicy: { policyId: 'p', version: 1 }, riskPolicy: { policyId: 'p', version: 1 }, configDigests: { worldConfigHash: 'h', engineConfigHash: 'h', dataset: 'd' }, run: { runId: 'r', episodeId: 'e' }, cursor: { cursorId: 'c', position: 1 }, seed: 'seed', tenant: 'tenant-a', project: 'prj-a' },
    shadowOutcomeRef: 'shr', shadowOutcomeOrdinal: 1, shadowAsOf: at, decisionStreamPosition: 1, trajectoryRef: null, experiment: null,
  },
  asOf: at, priorChainHead: '0'.repeat(64),
});

const utilizationOf = (projectId: string, breachesAt: readonly number[]): RiskUtilizationRead => ({
  projectId,
  asOf: formatInstantUtc(VIEW_AT),
  bounds: [
    { constraintId: 'k-capital-budget', metric: 'outcome.capital.budget', boundMax: '10000.00', severity: 'blocking', current: 4860, source: 'the projected cumulative book of every routed fill on record', status: 'ok' },
    { constraintId: 'k-risk-budget', metric: 'outcome.risk.budget', boundMax: '250.00', severity: 'blocking', current: null, source: 'the outcome records are not readable by this read on this backing', status: 'unknown' },
    { constraintId: 'k-turnover', metric: 'action.costs.dailyTurnover', boundMax: '500.00', severity: 'blocking', current: 259374.99, source: 'the sum of filled notional over the latest UTC trading day on record', status: 'breach' },
  ],
  activeBreaches: breachesAt.map((at, index) => ({
    kind: 'risk_limits_refusal' as const, submissionId: `xgs:br-${index}`, auditId: `xga:br-${index}`, stage: 'risk_limits',
    at: formatInstantUtc(at),
    violations: [{ constraintId: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', severity: 'blocking', predicate: { kind: 'limit.max', bound: 10000 }, observed: '184859.99' }],
  })),
  disclosure: 'the read\'s own disclosure',
});

/** Boot a workspace whose directory carries two session-own desks, the shared demo desk, and one OTHER session's desk. */
function oversightWorkspace(): WorkspaceState {
  return reduceAll(openWorkspace({ tenantId: 'tenant-a', projectId: 'prj-a' }, T0), [
    { kind: 'projects-listed', at: T0 + 1, records: [
      project('prj-a', 'Desk A', 'session-owned'),
      project('prj-b', 'Desk B', 'session-owned'),
      project(DEMO_PROJECT_ID, 'the TradRL demo project', 'tenant-available'),
      project('prj-s1-desk', 'S1 desk', 'tenant-available'), // ANOTHER session's desk — never in the fold
    ] },
  ]);
}

describe('FW-37-B (F-2): the oversight fold — the desks it aggregates', () => {
  it('aggregates EVERY session-own desk + the shared demo project — another session\'s desks NEVER enter (L12: the workspace boundary)', () => {
    const state = oversightWorkspace();
    const rows = oversightRowsOf(state, VIEW_AT);
    expect(rows.map((row) => row.projectId)).toEqual(['prj-a', 'prj-b', DEMO_PROJECT_ID]); // the directory's own order
    expect(rows.some((row) => row.projectId === 'prj-s1-desk')).toBe(false); // the foreign session's desk is NOT here
    expect(rows.find((row) => row.projectId === DEMO_PROJECT_ID)?.demo).toBe(true); // the demo desk carries its own marker
    expect(rows.find((row) => row.projectId === 'prj-a')?.demo).toBe(false);
    expect(oversightScopeNoteOf(state)).toContain('3 desks');
  });

  it('a desk without a read on record folds to its honest absence — never a fabricated number', () => {
    const rows = oversightRowsOf(oversightWorkspace(), VIEW_AT);
    const absent = rows.find((row) => row.projectId === 'prj-b');
    if (absent === undefined) throw new Error('prj-b is not in the fold');
    expect(absent.read).toBeNull();
    expect(absent.budgets).toEqual([]);
    expect(absent.fills).toBe(0);
    expect(absent.decisions).toBe(0);
    expect(absent.breachesAtView).toBe(0);
    expect(absent.asOf).toBeNull();
  });
});

describe('FW-37-B (F-2): the oversight fold — the per-desk budget rows', () => {
  it('the capital and risk budget rows lead (bound + honest current, verbatim), every other bound after in the read\'s own order', () => {
    const rows = oversightBudgetRowsOf(utilizationOf('prj-a', []));
    expect(rows.map((row) => row.metric)).toEqual(['outcome.capital.budget', 'outcome.risk.budget', 'action.costs.dailyTurnover']);
    expect(rows[0]?.boundMax).toBe('10000.00');
    expect(rows[0]?.current).toBe(4860);
    expect(rows[0]?.status).toBe('ok');
    expect(rows[1]?.current).toBeNull(); // honestly unknown — never a fabricated zero
    expect(rows[1]?.status).toBe('unknown');
    expect(rows[2]?.status).toBe('breach'); // the read's own verdict, never re-decided
    expect(oversightBudgetRowsOf(null)).toEqual([]);
  });
});

describe('FW-37-B (F-2): the oversight fold — the L4 view-instant projection', () => {
  it('every per-desk count is the VIEW-INSTANT projection: a fill/refusal/decision observed AFTER the view instant never renders', () => {
    const read: OversightDeskRead = {
      projectId: 'prj-a',
      utilization: utilizationOf('prj-a', [VIEW_AT - 1000, VIEW_AT + 5000]),
      submissions: [
        routedFill('xgs:past-1', VIEW_AT - 2000),          // visible
        routedFill('xgs:future-1', VIEW_AT + 1000),        // post-view — hidden
        refusedRow('xgs:ref-past', VIEW_AT - 500),         // visible
        refusedRow('xgs:ref-future', VIEW_AT + 2000),      // post-view — hidden
      ],
      decisions: [
        decision('past', VIEW_AT - 3000),                  // visible
        decision('future', VIEW_AT + 4000),                // post-view — hidden
      ],
      readAt: VIEW_AT,
    };
    const state = reduceAll(oversightWorkspace(), [{ kind: 'oversight-read', at: VIEW_AT, read }]);
    const row = oversightRowsOf(state, VIEW_AT).find((candidate) => candidate.projectId === 'prj-a');
    if (row === undefined) throw new Error('prj-a is not in the fold');
    expect(row.fills).toBe(1);            // only the pre-view fill
    expect(row.refusals).toBe(1);         // only the pre-view refusal
    expect(row.decisions).toBe(1);        // only the pre-view decision
    expect(row.latestDecision?.decisionRef).toBe('xd:past');
    expect(row.breachesAtView).toBe(1);   // only the breach observed BY the view instant (the F-6 law in the fold)
    expect(row.breachesTotal).toBe(2);    // the standing read's own count — named for the note, never hidden
  });

  it('a breach whose observed instant is unreadable is excluded from the view count (the L4-conservative choice, never a fabricated past-ness)', () => {
    const unreadable = { ...utilizationOf('prj-a', []), activeBreaches: [{ kind: 'risk_limits_refusal' as const, submissionId: 'xgs:br-x', auditId: 'xga:br-x', stage: 'risk_limits', at: 'not-an-instant' }] };
    const read: OversightDeskRead = { projectId: 'prj-a', utilization: unreadable, submissions: [], decisions: [], readAt: VIEW_AT };
    const state = reduceAll(oversightWorkspace(), [{ kind: 'oversight-read', at: VIEW_AT, read }]);
    const row = oversightRowsOf(state, VIEW_AT).find((candidate) => candidate.projectId === 'prj-a');
    expect(row?.breachesAtView).toBe(0);
    expect(row?.breachesTotal).toBe(1);
  });
});

describe('FW-37-B (F-2): the oversight ingest gate (workspace.ts\'s oversight-read arm)', () => {
  it('a FOREIGN TENANT\'s decision record is the typed CrossTenantRenderError — it never enters the state', () => {
    const foreign = { ...decision('foreign', VIEW_AT - 1000), tenant: 'tenant-b' };
    const read: OversightDeskRead = { projectId: 'prj-a', utilization: null, submissions: [], decisions: [foreign], readAt: VIEW_AT };
    expect(() => reduceAll(oversightWorkspace(), [{ kind: 'oversight-read', at: VIEW_AT, read }])).toThrow(CrossTenantRenderError);
  });

  it('a CROSSED utilization read (another project\'s) is refused — the bundle must be its own desk\'s', () => {
    const read: OversightDeskRead = { projectId: 'prj-a', utilization: utilizationOf('prj-b', []), submissions: [], decisions: [], readAt: VIEW_AT };
    expect(() => reduceAll(oversightWorkspace(), [{ kind: 'oversight-read', at: VIEW_AT, read }])).toThrow(/own project scope/);
  });

  it('the merge is per-desk replace-by-projectId — a re-read refreshes the desk\'s bundle, the others keep theirs', () => {
    const first: OversightDeskRead = { projectId: 'prj-a', utilization: utilizationOf('prj-a', []), submissions: [routedFill('xgs:1', VIEW_AT - 100)], decisions: [], readAt: VIEW_AT };
    const second: OversightDeskRead = { projectId: 'prj-b', utilization: null, submissions: [], decisions: [], readAt: VIEW_AT + 1 };
    const state = reduceAll(oversightWorkspace(), [
      { kind: 'oversight-read', at: VIEW_AT, read: first },
      { kind: 'oversight-read', at: VIEW_AT + 1, read: second },
    ]);
    expect(state.oversight.map((entry) => entry.projectId).sort()).toEqual(['prj-a', 'prj-b']);
    const refilled: OversightDeskRead = { projectId: 'prj-a', utilization: null, submissions: [], decisions: [], readAt: VIEW_AT + 2 };
    const refreshed = reduceAll(state, [{ kind: 'oversight-read', at: VIEW_AT + 2, read: refilled }]);
    expect(refreshed.oversight).toHaveLength(2); // replaced, never duplicated
    expect(refreshed.oversight.find((entry) => entry.projectId === 'prj-a')?.submissions).toEqual([]);
  });
});

describe('FW-37-B (F-6 helper): parseInstantUtc — the pure inverse of formatInstantUtc', () => {
  it('round-trips every canonical instant, and refuses anything the grammar does not cover', () => {
    for (const at of [0, 1, 999, T0, VIEW_AT, 4_102_444_800_000]) {
      expect(parseInstantUtc(formatInstantUtc(at))).toBe(at);
    }
    expect(parseInstantUtc('2026-10-09T12:34:56Z')).toBeNull();      // no millis
    expect(parseInstantUtc('2026-10-09 12:34:56.789Z')).toBeNull();  // no T
    expect(parseInstantUtc('2026-10-09T12:34:56.789+00:00')).toBeNull(); // no offset form
    expect(parseInstantUtc('')).toBeNull();
  });
});
