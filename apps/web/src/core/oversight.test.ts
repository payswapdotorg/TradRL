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
//
// FW-38-B (Round G register G-2 + G-3 + G-5 + G-12 — the truth wave)
// pins:
//   - G-2: the standing rows derive from the desk's own FILLS (the
//     cumulative booked notional + the open-position count at the view
//     instant), NEVER from the gate's projection — a desk with 2
//     compliant fills + 1 refused candidate renders standing = the
//     fills' book, positions = 2, NO false breach;
//   - G-3: the row carries the desk's ORG operating status (the
//     bundle's own snapshot), never the project-record lifecycle;
//   - G-5: a gate observation withholds at a view instant before its
//     own observed instant;
//   - G-12: the row's standingAsOf is the DATA'S OWN AS-OF (the newest
//     fill or non-withheld observation), never the read-capture
//     instant.

import { describe, expect, it } from 'vitest';
import type { GatewaySubmissionRecord, OutcomeRecord, ProjectRecord, RiskUtilizationRead } from '../api/contracts';
import { CrossTenantRenderError } from './errors';
import { DEMO_PROJECT_ID } from './tenant';
import { formatInstantUtc, parseInstantUtc } from './format';
import { oversightAggregateOf, oversightRowsOf, oversightScopeNoteOf, type OversightDeskRead } from './oversight';
import { standingBookOf, standingReadFoldOf } from './standing';
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

const routedFill = (id: string, at: number, notional = '100.00'): GatewaySubmissionRecord => ({
  kind: 'routed', submissionId: id, decisionId: `xd:${id}`, auditId: `xga:${id}`, requestRef: `gor:${id}`,
  venue: 'binance', adapterRef: 'adapter', channelRef: 'channel', routedAt: at,
  fill: { state: 'filled', quantity: '1', price: '100', notional, fee: '0.10', filledAt: at },
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
    expect(oversightScopeNoteOf(state, VIEW_AT)).toContain('3 desks');
  });

  it('a desk without a read on record folds to its honest absence — never a fabricated number', () => {
    const rows = oversightRowsOf(oversightWorkspace(), VIEW_AT);
    const absent = rows.find((row) => row.projectId === 'prj-b');
    if (absent === undefined) throw new Error('prj-b is not in the fold');
    expect(absent.read).toBeNull();
    expect(absent.standing).toEqual([]);
    expect(absent.fills).toBe(0);
    expect(absent.decisions).toBe(0);
    expect(absent.breachesAtView).toBe(0);
    expect(absent.asOf).toBeNull();
    expect(absent.standingAsOf).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FW-38-B (Round G register G-2 + G-5 + G-12): the fill-derived standing
// book (core/standing.ts) — the truth wave's core fold. The pre-fix
// standing rows rendered the read's own `current` (the boundary's read
// puts the LAST GATE OBSERVATION — the refused candidate's projection —
// at precedence 1), so every compliant desk with one refusal read as a
// standing breach at 38-445x overstatement and the position standing
// read "unknown" while the blotter showed open fills.
// ---------------------------------------------------------------------------

describe('FW-38-B (G-2): the standing rows read the FILL-DERIVED BOOK, never the gate observation', () => {
  it('THE PIN: a desk with 2 compliant fills + 1 refused candidate renders standing = the fills\' book, positions = 2, NO false breach (the projection stays labeled, never the book)', () => {
    // L1's D1 exact shape: capital bound 2,000,000 / position bound 2; the
    // desk holds 360,000 across 2 fills; the refused candidate projected
    // 2,359,999.92 capital / 3 positions — the pre-fix card read both as
    // standing BREACHES.
    const read: RiskUtilizationRead = {
      projectId: 'prj-a',
      asOf: formatInstantUtc(VIEW_AT + 60_000), // the READ-CAPTURE instant (G-12: never cited as the data's as-of)
      bounds: [
        { constraintId: 'k-capital-budget', metric: 'outcome.capital.budget', boundMax: '2000000', severity: 'blocking', current: 2359999.92, source: 'the risk-limits refusal xgs:ref-1 (audit xga:ref-1) observed at ... — a point-in-time gate observation, not a live re-computation', status: 'breach' },
        { constraintId: 'k-position', metric: 'state.position.grossExposure', boundMax: '2', severity: 'blocking', current: 3, source: 'the risk-limits refusal xgs:ref-1 (audit xga:ref-1) observed at ... — a point-in-time gate observation', status: 'breach' },
      ],
      activeBreaches: [{
        kind: 'risk_limits_refusal', submissionId: 'xgs:ref-1', auditId: 'xga:ref-1', stage: 'risk_limits',
        at: formatInstantUtc(VIEW_AT - 500),
        violations: [
          { constraintId: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', severity: 'blocking', predicate: { kind: 'limit.max', bound: 2000000 }, observed: '2359999.92' },
          { constraintId: 'k-position', domain: 'state', subject: 'position.grossExposure', severity: 'blocking', predicate: { kind: 'limit.max', bound: 2 }, observed: '3' },
        ],
      }],
      disclosure: 'the read\'s own disclosure',
    };
    const submissions = [
      routedFill('xgs:fill-1', VIEW_AT - 3000, '180000.00'),
      routedFill('xgs:fill-2', VIEW_AT - 2000, '180000.00'),
      refusedRow('xgs:ref-1', VIEW_AT - 500),
    ];
    const fold = standingReadFoldOf(read, submissions, VIEW_AT);
    const capital = fold.rows.find((row) => row.constraintId === 'k-capital-budget');
    if (capital === undefined) throw new Error('the capital row is missing');
    expect(capital.standing).toBe(360000);      // the FILL-DERIVED book (180,000 x 2) — never the 2,359,999.92 projection
    expect(capital.standingStatus).toBe('ok');  // the fill-derived book vs the bound — NO false breach
    expect(capital.observation?.value).toBe(2359999.92); // the projection stays visible ...
    expect(capital.observation?.withheldAtView).toBe(false); // ... labeled as the last gate observation
    const position = fold.rows.find((row) => row.constraintId === 'k-position');
    if (position === undefined) throw new Error('the position row is missing');
    expect(position.standing).toBe(2);          // positions = 2 (the fills on record) — never "unknown", never the projected 3
    expect(position.standingStatus).toBe('ok'); // 2 open positions vs the bound 2 — NO false breach
  });

  it('the book itself: cumulative booked notional (exact decimals), open positions, the latest-day notional, and the newest fill instant', () => {
    const book = standingBookOf([
      routedFill('xgs:1', VIEW_AT - 5000, '100.10'),
      routedFill('xgs:2', VIEW_AT - 4000, '50.005'),
      refusedRow('xgs:r', VIEW_AT - 3000),
    ]);
    expect(book.fills).toBe(2);                 // the refusal is never a fill
    expect(book.bookedNotional).toBe('150.105'); // an exact-decimal sum, never float arithmetic
    expect(book.newestFillAt).toBe(VIEW_AT - 4000);
  });

  it('the standing verdict is a decimal comparison — never a float guess (10 vs 9, fractions, equal values)', () => {
    const fold = standingReadFoldOf({
      projectId: 'prj-a', asOf: formatInstantUtc(VIEW_AT),
      bounds: [{ constraintId: 'k-cap', metric: 'outcome.capital.budget', boundMax: '9', severity: 'blocking', current: null, source: '', status: 'unknown' }],
      activeBreaches: [], disclosure: '',
    }, [routedFill('xgs:1', VIEW_AT - 1000, '10')], VIEW_AT);
    expect(fold.rows[0]?.standingStatus).toBe('breach'); // 10 > 9 — the whole-part comparison is numeric, never lexicographic
  });

  it('the capital and risk budget rows lead, every other bound after in the read\'s own order; an absent read folds to empty rows', () => {
    const fold = standingReadFoldOf(utilizationOf('prj-a', []), [], VIEW_AT);
    expect(fold.rows.map((row) => row.metric)).toEqual(['outcome.capital.budget', 'outcome.risk.budget', 'action.costs.dailyTurnover']);
    expect(standingReadFoldOf(null, [], VIEW_AT).rows).toEqual([]);
  });
});

describe('FW-38-B (G-5 + G-12): the observation withholding + the data\'s own as-of', () => {
  it('G-5: at a scrubbed instant BEFORE the justifying refusal, the gate observation withholds — never rendered before its observed instant', () => {
    const read = utilizationOf('prj-a', [VIEW_AT + 5000]); // the refusal lands AFTER the view instant
    const before = standingReadFoldOf(read, [routedFill('xgs:1', VIEW_AT - 1000)], VIEW_AT);
    const capital = before.rows.find((row) => row.constraintId === 'k-capital-budget');
    if (capital === undefined) throw new Error('the capital row is missing');
    expect(capital.observation?.withheldAtView).toBe(true); // the projection whose refusal was NOT yet observed withholds
    const after = standingReadFoldOf(read, [routedFill('xgs:1', VIEW_AT - 1000)], VIEW_AT + 10_000);
    expect(after.rows.find((row) => row.constraintId === 'k-capital-budget')?.observation?.withheldAtView).toBe(false);
  });

  it('G-12: the data\'s own as-of is the NEWEST FILL (or non-withheld observation) the rows derive from — never the read-capture instant', () => {
    const read = utilizationOf('prj-a', [VIEW_AT - 500]);
    const fold = standingReadFoldOf(read, [routedFill('xgs:1', VIEW_AT - 3000), routedFill('xgs:2', VIEW_AT - 2000)], VIEW_AT);
    expect(fold.dataAsOf).toBe(VIEW_AT - 500); // the newest NON-WITHHELD observation instant — the data's own as-of
    const noObservation = standingReadFoldOf(utilizationOf('prj-a', []), [routedFill('xgs:1', VIEW_AT - 3000)], VIEW_AT);
    expect(noObservation.dataAsOf).toBe(VIEW_AT - 3000); // the newest fill
    const empty = standingReadFoldOf(utilizationOf('prj-a', []), [], VIEW_AT);
    expect(empty.dataAsOf).toBeNull(); // nothing derives — honestly null, never the read-capture instant
  });
});

describe('FW-38-B (G-3): the row carries the desk\'s ORG operating status, never the project-record lifecycle', () => {
  it('the pill source: the bundle\'s own org-status snapshot (verbatim, whatever the boundary serves); no snapshot = the honest null', () => {
    const compiled: OversightDeskRead = {
      projectId: 'prj-a', utilization: null, submissions: [], decisions: [], readAt: VIEW_AT,
      orgStatus: { organizationRef: 'org:a', tenant: 'tenant-a', project: 'prj-a', status: 'active', at: VIEW_AT - 1000, instanceRefs: ['ai:director-1'] },
    };
    const state = reduceAll(oversightWorkspace(), [{ kind: 'oversight-read', at: VIEW_AT, read: compiled }]);
    const row = oversightRowsOf(state, VIEW_AT).find((candidate) => candidate.projectId === 'prj-a');
    if (row === undefined) throw new Error('prj-a is not in the fold');
    expect(row.orgStatus).toBe('active'); // the ORG status — the compiled desk's own truth
    expect(row.status).toBe('active');    // the project lifecycle keeps its own labeled fact row (a different entity)
    const none = oversightRowsOf(oversightWorkspace(), VIEW_AT).find((candidate) => candidate.projectId === 'prj-b');
    expect(none?.orgStatus).toBeNull();   // no snapshot on record — the honest absence, never a fabricated status
  });

  it('the ingest gate: a CROSSED org-status snapshot (another desk\'s) is refused — the bundle must be its own desk\'s', () => {
    const crossed: OversightDeskRead = {
      projectId: 'prj-a', utilization: null, submissions: [], decisions: [], readAt: VIEW_AT,
      orgStatus: { organizationRef: 'org:b', tenant: 'tenant-a', project: 'prj-b', status: 'active', at: VIEW_AT - 1000, instanceRefs: [] },
    };
    expect(() => reduceAll(oversightWorkspace(), [{ kind: 'oversight-read', at: VIEW_AT, read: crossed }])).toThrow(/org-status snapshot's own project scope/);
  });

  it('FW-38-B (G-8\'s UI half, consumed defensively): the fold passes the utilization read\'s desk-level ENTRY-BLOCKED status through verbatim — present, absent (a backing that predates the field), and served-null all fold honestly', () => {
    // The FW-38-A runtime contract (PR #81) rides the utilization read
    // ADDITIVELY; the fold never re-decides it, never fabricates one.
    const entryBlocked = {
      status: 'entry-blocked' as const,
      constraintId: 'k-concentration', domain: 'state', subject: 'position.concentration',
      gateClass: 'position_concentration' as const, predicateKind: 'limit.max', bound: '0.25', severity: 'blocking',
      reason: 'the first candidate is 100% of the projected book and 1 > 0.25, so no candidate can ever be admissible',
    };
    const blocked: OversightDeskRead = { projectId: 'prj-a', utilization: { ...utilizationOf('prj-a', []), entryBlocked }, submissions: [], decisions: [], readAt: VIEW_AT };
    const served = oversightRowsOf(reduceAll(oversightWorkspace(), [{ kind: 'oversight-read', at: VIEW_AT, read: blocked }]), VIEW_AT).find((candidate) => candidate.projectId === 'prj-a');
    if (served === undefined) throw new Error('prj-a is not in the fold');
    expect(served.entryBlocked).toEqual(entryBlocked); // verbatim — the render layer's single source
    // absent on the read (an origin that predates the field) and served null both fold to null — never a fabricated cause
    const absent: OversightDeskRead = { projectId: 'prj-a', utilization: utilizationOf('prj-a', []), submissions: [], decisions: [], readAt: VIEW_AT };
    const foldedAbsent = oversightRowsOf(reduceAll(oversightWorkspace(), [{ kind: 'oversight-read', at: VIEW_AT, read: absent }]), VIEW_AT).find((candidate) => candidate.projectId === 'prj-a');
    expect(foldedAbsent?.entryBlocked ?? null).toBeNull();
    const explicitNull: OversightDeskRead = { projectId: 'prj-a', utilization: { ...utilizationOf('prj-a', []), entryBlocked: null }, submissions: [], decisions: [], readAt: VIEW_AT };
    const foldedNull = oversightRowsOf(reduceAll(oversightWorkspace(), [{ kind: 'oversight-read', at: VIEW_AT, read: explicitNull }]), VIEW_AT).find((candidate) => candidate.projectId === 'prj-a');
    expect(foldedNull?.entryBlocked ?? null).toBeNull();
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

// ---------------------------------------------------------------------------
// FW-40-A (Round H register H-3 — L2's find, the escalation-surface lie,
// one row over from G-2's fix): the position.concentration standing row
// reads the FILL-DERIVED FRACTION — the largest single position's
// notional share of the book — or honestly unknown, NEVER the
// open-position COUNT against a fraction bound. L2's exact reproduction:
// "the POSITION.CONCENTRATION standing row renders the open-position
// COUNT against the fraction bound — '2 · breach (the desk's own fills
// at this view instant, never a gate observation)' — while the gate's
// own C-4 verdict on the same page passes the true concentration
// fraction (0.998502 <= 1) and the book is compliant on every class
// (capital 900/600000, count 2/4, turnover 900/1200, standing fraction
// 599.976/900 = 0.6664 <= 1). At bound 1 the row is false BY
// CONSTRUCTION whenever >= 2 fills exist." The same surface-class G-2
// fixed, one row over.
// ---------------------------------------------------------------------------

describe('FW-40-A (H-3): the concentration standing row reads the FILL-DERIVED FRACTION — never the count against a fraction bound', () => {
  /** L2's exact book: 2 compliant fills — 599.976 (the largest) + 300.024, total booked notional 900. */
  const l2Fills = (): GatewaySubmissionRecord[] => [
    routedFill('xgs:l2-1', VIEW_AT - 3000, '599.976'),
    routedFill('xgs:l2-2', VIEW_AT - 2000, '300.024'),
  ];

  const concentrationRead = (boundMax: string): RiskUtilizationRead => ({
    projectId: 'prj-a',
    asOf: formatInstantUtc(VIEW_AT + 60_000),
    bounds: [
      { constraintId: 'k-concentration', metric: 'state.position.concentration', boundMax, severity: 'blocking', current: null, source: 'the standing risk-utilization read serves no concentration current on this backing', status: 'unknown' },
      { constraintId: 'k-position', metric: 'state.position.grossExposure', boundMax: '2', severity: 'blocking', current: null, source: 'no position or equity store exists on any backing', status: 'unknown' },
    ],
    activeBreaches: [],
    disclosure: 'the read\'s own disclosure',
  });

  it('(a) THE PIN: 2 open positions with fraction 0.66664 <= bound 1 render NOT-a-breach WITH THE FRACTION — L2\'s compliant book never reads "2 · breach" again', () => {
    const fold = standingReadFoldOf(concentrationRead('1'), l2Fills(), VIEW_AT);
    const concentration = fold.rows.find((row) => row.constraintId === 'k-concentration');
    if (concentration === undefined) throw new Error('the concentration row is missing');
    expect(concentration.standing).toBe(0.66664); // the FILL-DERIVED fraction (599.976 / 900) — never the count 2
    expect(concentration.standingStatus).toBe('ok'); // 0.66664 <= 1 — NOT a breach (L2's false breach, dead by construction)
    expect(concentration.standingBasis).toContain('largest single position');
    expect(concentration.standingBasis).toContain('never the open-position count');
  });

  it('(b) a TRUE fraction breach renders the breach stamp — the fraction against the fraction bound, exactly as declared', () => {
    const fold = standingReadFoldOf(concentrationRead('0.5'), l2Fills(), VIEW_AT);
    const concentration = fold.rows.find((row) => row.constraintId === 'k-concentration');
    if (concentration === undefined) throw new Error('the concentration row is missing');
    expect(concentration.standing).toBe(0.66664);
    expect(concentration.standingStatus).toBe('breach'); // 0.66664 > 0.5 — the honest stamp on a true breach
  });

  it('(c) the COUNT is never compared against the fraction bound: the same book\'s gross-exposure row keeps the count against its own count bound (two classes, two units, one fold)', () => {
    const fold = standingReadFoldOf(concentrationRead('1'), l2Fills(), VIEW_AT);
    const concentration = fold.rows.find((row) => row.constraintId === 'k-concentration');
    const exposure = fold.rows.find((row) => row.constraintId === 'k-position');
    if (concentration === undefined || exposure === undefined) throw new Error('a row is missing');
    expect(concentration.standing).not.toBe(2);              // the count never wears the fraction row
    expect(concentration.standing).toBe(0.66664);            // the fraction
    expect(exposure.standing).toBe(2);                       // the count serves ITS OWN class (the gross-exposure bound)
    expect(exposure.standingStatus).toBe('ok');              // 2 <= 2 — the same compliant book
    expect(concentration.standingStatus).toBe('ok');         // 0.66664 <= 1 — and the fraction serves its own
  });

  it('the boundary\'s own construction constants: a sole position\'s fraction is 1 (whatever its size); no fills = honestly unknown, never a fabricated fraction', () => {
    // the sole fill: 100% of the book by construction — the gate's own entry arithmetic, mirrored
    const sole = standingReadFoldOf(concentrationRead('1'), [routedFill('xgs:sole', VIEW_AT - 1000, '123.45')], VIEW_AT);
    const soleRow = sole.rows.find((row) => row.constraintId === 'k-concentration');
    if (soleRow === undefined) throw new Error('the concentration row is missing');
    expect(soleRow.standing).toBe(1);
    expect(soleRow.standingStatus).toBe('ok'); // 1 <= 1 — the sole-position law, honest at the bound
    // no fills on record: the honest unknown (the page's own honesty law), never a zero fraction, never the count
    const empty = standingReadFoldOf(concentrationRead('1'), [], VIEW_AT);
    const emptyRow = empty.rows.find((row) => row.constraintId === 'k-concentration');
    if (emptyRow === undefined) throw new Error('the concentration row is missing');
    expect(emptyRow.standing).toBeNull();
    expect(emptyRow.standingStatus).toBe('unknown');
    expect(emptyRow.standingBasis).toContain('never the open-position count');
  });

  it('the book\'s own fold carries the largest single fill (the fraction\'s numerator — exact decimals, never a float)', () => {
    const book = standingBookOf(l2Fills());
    expect(book.fills).toBe(2);
    expect(book.bookedNotional).toBe('900.000');
    expect(book.largestFillNotional).toBe('599.976');
    expect(standingBookOf([]).largestFillNotional).toBe('0'); // the honest empty book
  });
});

// ---------------------------------------------------------------------------
// FW-41-C (Round I register I-7 — the served-read sidecar's instant
// projection, H-2's sibling residue). L1: "the RISK.BUDGET 'served read
// 0.147 · ok' sidecar renders at the past instant while the standing
// rows honestly read unknown" — the read's own non-observation
// `current` (its fill/outcome-derived precedence-2 number) is a
// CAPTURE that exists only from the read's own serve instant (`asOf`)
// onward. THE LAW (the G-5 form): a capture that did not exist at the
// view instant NEVER renders there; an unparseable serve instant
// withholds too (the L4-conservative choice).
// ---------------------------------------------------------------------------

describe('FW-41-C (I-7): the served-read sidecar withholds before its own serve instant', () => {
  it('a served current NEVER renders at a view instant before the read\'s asOf — and renders verbatim with its source AT or after it', () => {
    const read = utilizationOf('prj-a', []); // asOf = formatInstantUtc(VIEW_AT); the k-turnover bound carries a non-observation current
    const turnover = read.bounds.find((bound) => bound.constraintId === 'k-turnover');
    if (turnover === undefined) throw new Error('fixture: no k-turnover bound');
    expect(turnover.current).not.toBeNull(); // the fixture's served-class bound (no breach cites it — the observation path never fires)
    // BEFORE the serve instant: the capture did not exist at the view — WITHHELD
    const before = standingReadFoldOf(read, [], VIEW_AT - 1);
    expect(before.rows.find((row) => row.constraintId === 'k-turnover')?.served).toBeNull(); // RED pre-fix: the sidecar rendered at ANY view instant (L1's exact finding)
    // AT the serve instant: the capture exists — the served row renders verbatim with its source
    const atServe = standingReadFoldOf(read, [], VIEW_AT);
    expect(atServe.rows.find((row) => row.constraintId === 'k-turnover')?.served).toMatchObject({
      value: 259374.99,
      status: 'breach',
      source: 'the sum of filled notional over the latest UTC trading day on record',
    });
  });

  it('an UNPARSEABLE serve instant withholds too (the L4-conservative choice — never a fabricated past-ness)', () => {
    const read = { ...utilizationOf('prj-a', []), asOf: 'not-an-instant' };
    const fold = standingReadFoldOf(read, [], VIEW_AT);
    expect(fold.rows.find((row) => row.constraintId === 'k-turnover')?.served).toBeNull(); // RED pre-fix: rendered (the asOf was never read)
  });
});

// ---------------------------------------------------------------------------
// FW-42-B (the Round J copy-lag — 6/6 pure testers): the scope note under a
// signed-in principal tells the ACCOUNT-SCOPED truth. The Round J pure test
// (clear localStorage → reload → same-account sign-in) proved the desks
// follow the ACCOUNT (M3's six, L2's six, L1's five — all in the switcher
// from a wiped context), while the copy still said "this session's own
// desks" (the register: "the copy undersells the fix"). THE LAW: an
// authenticated principal reads "your desks" (every desk that follows the
// account, whatever browser launched it); an anonymous session keeps the
// exact session-scoped sentence — honest for it (this device's storage is
// the only thing that remembers an anonymous session's desks). The L12
// wall clause stays in both.
// ---------------------------------------------------------------------------

describe('FW-42-B (the copy-lag): the scope note is account-scoped under a signed-in principal', () => {
  it('authenticated: "your desks" + the account-following wording — never the session-scoped undersell', () => {
    const note = oversightScopeNoteOf(oversightWorkspace(), VIEW_AT, true);
    expect(note).toContain('One governed view of your desks in workspace tenant-a');
    expect(note).toContain('every desk that follows your account, whatever browser launched it');
    expect(note).toContain('3 desks at this view instant');
    expect(note).not.toContain("this session's own desks"); // the undersell is gone under a principal
  });

  it('the L12 wall clause stays in BOTH postures (other sessions\' desks never appear here)', () => {
    expect(oversightScopeNoteOf(oversightWorkspace(), VIEW_AT, true)).toContain("Other sessions' desks in this workspace never appear here");
    expect(oversightScopeNoteOf(oversightWorkspace(), VIEW_AT, false)).toContain("Other sessions' desks in this workspace never appear here");
  });

  it('anonymous keeps the exact pre-fix sentence (the session-scoped copy is HONEST for it)', () => {
    const note = oversightScopeNoteOf(oversightWorkspace(), VIEW_AT);
    expect(note).toContain("One governed view of this session's own desks in workspace tenant-a");
    expect(note).toContain('the session\'s own launched projects plus the shared demo desk');
    expect(note).not.toContain('your desks');
  });
});

// ---------------------------------------------------------------------------
// FW-43-A (Round K register §3.2 — the product list's #2, M1 + L1's #1
// YES-gate item, DOM-verified absent three rounds running): THE OVERSIGHT
// COCKPIT's model half. The personas, verbatim:
//   M1 (Head of Trading, mid AM): "the Oversight cockpit (drill-through
//   from breach counts, per-desk P&L/net-exposure, cross-desk
//   aggregates) — DOM-verified absent again".
//   L1 (Senior PM, large fund): "cross-desk aggregate row across my
//   desks (net-exposure/utilization/P&L roll-up), per-desk
//   P&L/net-exposure columns, drill-through from breach counts to
//   blotters".
// THE LAWS this fold owns (the work order's own words):
//   - the PER-DESK COCKPIT numbers (net exposure = the gross booked
//     notional of the open positions — the fill-derived book's own
//     composition, the same data the standing rows ride; the simulated
//     P&L basis = the booked notional + fees to date) are carried on
//     each row as HONEST NULLABLES: a desk without a read bundle on
//     record folds every cockpit field to null — never a fabricated 0 —
//     and the breach field is null when the bundle carries no standing
//     read (the blotter fields stay known; per-field honesty);
//   - THE CROSS-DESK AGGREGATE ROW rolls up the SAME numbers the cards
//     carry, at the SAME view instant (the identical L4 projection the
//     cards ride): each field is the exact sum of the known per-desk
//     fields, and reads UNKNOWN when ANY desk's own field is unknown —
//     never a fabricated sum;
//   - a true P&L is NEVER fabricated: no mark-to-market exists on any
//     backing, so the fold composes only the numbers the fills carry
//     (notional + fee) and the render labels them as the SIMULATED
//     world's book value, not a market P&L.
// ---------------------------------------------------------------------------

describe('FW-43-A: the per-desk cockpit numbers (net exposure + the simulated P&L basis)', () => {
  /** Two fills (100.00 + 50.005 = 150.005 exact), one stopped refusal, one decision, one pre-view breach — prj-a's bundle. */
  function alphaBundle(): OversightDeskRead {
    return {
      projectId: 'prj-a',
      utilization: utilizationOf('prj-a', [VIEW_AT - 1000]),
      submissions: [
        routedFill('xgs:a-1', VIEW_AT - 2000, '100.00'),
        routedFill('xgs:a-2', VIEW_AT - 1500, '50.005'),
        refusedRow('xgs:a-ref', VIEW_AT - 500),
        routedFill('xgs:a-future', VIEW_AT + 9999, '999'), // post-view — never enters the book (L4)
      ],
      decisions: [decision('a-1', VIEW_AT - 800)],
      readAt: VIEW_AT,
    };
  }

  it('net exposure is the gross booked notional of the open positions (exact decimals) with the open-position count, the fee total, and the counts — all L4-projected at the view instant', () => {
    const state = reduceAll(oversightWorkspace(), [{ kind: 'oversight-read', at: VIEW_AT, read: alphaBundle() }]);
    const row = oversightRowsOf(state, VIEW_AT).find((candidate) => candidate.projectId === 'prj-a');
    if (row === undefined) throw new Error('prj-a is not in the fold');
    // net exposure: the fill-derived book's own composition (100.00 + 50.005 — exact, never float)
    expect(row.cockpit.netExposure).toBe('150.005');
    expect(row.cockpit.openPositions).toBe(2);    // the two pre-view fills (the post-view one is projected away)
    expect(row.cockpit.feeTotal).toBe('0.20');    // 0.10 + 0.10 — exact decimals
    expect(row.cockpit.fills).toBe(2);            // the bundle's blotter answered (L4-projected)
    expect(row.cockpit.refusals).toBe(1);
    expect(row.cockpit.decisions).toBe(1);
    expect(row.cockpit.breaches).toBe(1);         // the one breach observed BY the view instant
  });

  it('a desk without a read bundle folds EVERY cockpit field to null — never a fabricated 0 (the honest law the aggregate rolls up)', () => {
    const rows = oversightRowsOf(oversightWorkspace(), VIEW_AT);
    const unread = rows.find((candidate) => candidate.projectId === 'prj-b');
    if (unread === undefined) throw new Error('prj-b is not in the fold');
    expect(unread.read).toBeNull();
    expect(unread.cockpit).toEqual({
      openPositions: null, netExposure: null, feeTotal: null,
      fills: null, refusals: null, decisions: null, breaches: null,
    });
  });

  it('per-field honesty: a bundle without a standing read keeps the blotter fields KNOWN but folds breaches to null', () => {
    const bundle: OversightDeskRead = { projectId: 'prj-b', utilization: null, submissions: [routedFill('xgs:b-1', VIEW_AT - 1000, '10')], decisions: [], readAt: VIEW_AT };
    const state = reduceAll(oversightWorkspace(), [{ kind: 'oversight-read', at: VIEW_AT, read: bundle }]);
    const row = oversightRowsOf(state, VIEW_AT).find((candidate) => candidate.projectId === 'prj-b');
    if (row === undefined) throw new Error('prj-b is not in the fold');
    expect(row.cockpit.netExposure).toBe('10');   // the blotter answered
    expect(row.cockpit.fills).toBe(1);
    expect(row.cockpit.breaches).toBeNull();      // the standing read did not — the breach count is unknown, never 0
  });
});

describe('FW-43-A: the cross-desk aggregate fold (the headline)', () => {
  /** Every desk bundled: prj-a (2 fills + 1 refusal + 1 decision + 1 breach), prj-b (1 fill), the demo desk (an honest empty book). */
  function allBundledWorkspace(): WorkspaceState {
    return reduceAll(oversightWorkspace(), [
      { kind: 'oversight-read', at: VIEW_AT, read: {
        projectId: 'prj-a',
        utilization: utilizationOf('prj-a', [VIEW_AT - 1000]),
        submissions: [routedFill('xgs:a-1', VIEW_AT - 2000, '100.00'), routedFill('xgs:a-2', VIEW_AT - 1500, '50.005'), refusedRow('xgs:a-ref', VIEW_AT - 500), routedFill('xgs:a-future', VIEW_AT + 9999, '999')],
        decisions: [decision('a-1', VIEW_AT - 800)],
        readAt: VIEW_AT,
      } },
      { kind: 'oversight-read', at: VIEW_AT, read: {
        projectId: 'prj-b',
        utilization: utilizationOf('prj-b', []),
        submissions: [routedFill('xgs:b-1', VIEW_AT - 1000, '10')],
        decisions: [],
        readAt: VIEW_AT,
      } },
      { kind: 'oversight-read', at: VIEW_AT, read: {
        projectId: DEMO_PROJECT_ID,
        utilization: utilizationOf(DEMO_PROJECT_ID, []),
        submissions: [],
        decisions: [],
        readAt: VIEW_AT,
      } },
    ]);
  }

  it('sums every field across the desks at the view instant — the exact-decimal notional total, the same numbers the cards carry rolled up', () => {
    const aggregate = oversightAggregateOf(allBundledWorkspace(), VIEW_AT);
    expect(aggregate.desks).toBe(3);
    expect(aggregate.netExposureTotal).toBe('160.005'); // 150.005 + 10 + 0 — an exact-decimal sum, never float
    expect(aggregate.openPositions).toBe(3);           // 2 + 1 + 0
    expect(aggregate.fills).toBe(3);
    expect(aggregate.refusals).toBe(1);
    expect(aggregate.decisions).toBe(1);
    expect(aggregate.breaches).toBe(1);                // the one view-instant breach across every desk
    expect(aggregate.desksWithoutRead).toBe(0);
    expect(aggregate.desksWithoutStandingRead).toBe(0);
  });

  it('a desk without a read bundle makes every blotter field UNKNOWN — the total is never a fabricated sum, and the causes are counted', () => {
    // the base workspace: NO desk has a bundle on record
    const aggregate = oversightAggregateOf(oversightWorkspace(), VIEW_AT);
    expect(aggregate.desks).toBe(3);                  // the census itself is always known
    expect(aggregate.netExposureTotal).toBeNull();
    expect(aggregate.openPositions).toBeNull();
    expect(aggregate.fills).toBeNull();
    expect(aggregate.refusals).toBeNull();
    expect(aggregate.decisions).toBeNull();
    expect(aggregate.breaches).toBeNull();
    expect(aggregate.desksWithoutRead).toBe(3);
    // one bundled desk among three is still an unknown roll-up (any desk's field unknown)
    const mixed = oversightAggregateOf(reduceAll(oversightWorkspace(), [
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: 'prj-a', utilization: utilizationOf('prj-a', []), submissions: [routedFill('xgs:a-1', VIEW_AT - 1000, '100.00')], decisions: [], readAt: VIEW_AT } },
    ]), VIEW_AT);
    expect(mixed.desks).toBe(3);
    expect(mixed.netExposureTotal).toBeNull();
    expect(mixed.desksWithoutRead).toBe(2);
  });

  it('the breach field is unknown when any desk\'s standing read is missing (per-field honesty — the blotter fields can be known in the same breath)', () => {
    // every desk bundled; prj-b's bundle carries NO standing read — blotter known, breaches unknown
    const aggregate = oversightAggregateOf(reduceAll(oversightWorkspace(), [
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: 'prj-a', utilization: utilizationOf('prj-a', []), submissions: [routedFill('xgs:a-1', VIEW_AT - 1000, '100.00')], decisions: [], readAt: VIEW_AT } },
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: 'prj-b', utilization: null, submissions: [routedFill('xgs:b-1', VIEW_AT - 1000, '10')], decisions: [], readAt: VIEW_AT } },
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: DEMO_PROJECT_ID, utilization: utilizationOf(DEMO_PROJECT_ID, []), submissions: [], decisions: [], readAt: VIEW_AT } },
    ]), VIEW_AT);
    expect(aggregate.netExposureTotal).toBe('110.00'); // every blotter answered (100.00 + 10 + 0, padded to the widest fraction — exact)
    expect(aggregate.openPositions).toBe(2);
    expect(aggregate.fills).toBe(2);
    expect(aggregate.breaches).toBeNull();           // prj-b's standing read never answered
    expect(aggregate.desksWithoutRead).toBe(0);
    expect(aggregate.desksWithoutStandingRead).toBe(1);
  });

  it('L4: the aggregate rides the identical projection the cards ride — a post-view fill never enters the sums, and lands once the view passes it', () => {
    const state = allBundledWorkspace();
    const at = oversightAggregateOf(state, VIEW_AT);
    expect(at.fills).toBe(3);                        // the post-view fill (xgs:a-future, VIEW_AT + 9999) is excluded
    expect(at.netExposureTotal).toBe('160.005');
    const later = oversightAggregateOf(state, VIEW_AT + 20_000);
    expect(later.fills).toBe(4);                     // the view reached it — the same records, the same fold
    expect(later.netExposureTotal).toBe('1159.005'); // 100.00 + 50.005 + 999 + 10 — exact, never float
  });
});

// ---------------------------------------------------------------------------
// FW-44-A (Round L register L-1 — S1's find, one stable 5-poll window): the
// read-absence fold. During S1's read-absence window 3 desks' cards rendered
// LITERAL ZEROS ("fills 0", "net 0", "org not compiled" — contradicting the
// durable compile record and the desks' own live blotters) and the aggregate
// summed them as KNOWNS — the roll-up read 66,451.725 against the true
// 67,505.475, understated by exactly the desks' true values (1,053.75), with
// NO unknown marker on the money fields (only the breaches field went
// unknown). The other 8 personas' read-absence windows propagated unknown
// correctly — the absence shape that slipped past the fold was the
// PRESENT-BUT-EMPTY bundle: app/oversight-plane.ts's readDeskBundle composes
// exactly this shape when every per-desk route answers nothing in the window
// (each catch arm's null/[]), and the fold's only absence test was
// `read === null` — so the empty bundle's [] folded through blotterTotalsOf
// as POSITIVE zeros and the roll-up summed the gap.
//
// THE LAW (FW-44-A): a zero is a POSITIVE claim ("this desk has nothing on
// record") that only a CONFIRMED read may make. A bundle is a read ON
// RECORD only when at least one of its routes CONFIRMED something — a
// standing utilization read, a submission, a decision, or an org-status
// snapshot. The all-empty bundle is the honest absence: the row folds to the
// same no-read-on-record shape the pre-read absence rides, and the aggregate
// counts the desk in desksWithoutRead (never a fabricated sum over the gap).
// ---------------------------------------------------------------------------

describe('FW-44-A (Round L register L-1 — S1\'s find): the read-absence fold — an unconfirmed read never folds a positive zero', () => {
  /**
   * The S1 window's exact bundle shape: PRESENT on record but NOTHING
   * confirmed — no standing read, no submission, no decision, no org
   * snapshot (every route answered nothing for this desk in the window).
   */
  const unconfirmedBundle = (): OversightDeskRead => ({ projectId: 'prj-b', utilization: null, submissions: [], decisions: [], readAt: VIEW_AT });

  /**
   * S1's arithmetic mirror, small: prj-a confirmed with a true 100.00
   * book, the demo desk a CONFIRMED empty read (the standing read
   * answered; the empty blotter is its own positive claim), and prj-b
   * the unconfirmed window desk whose TRUE book is 1,053.75 (pinned by
   * the recovery test below — the register's exact understatement).
   */
  function s1WindowState(): WorkspaceState {
    return reduceAll(oversightWorkspace(), [
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: 'prj-a', utilization: utilizationOf('prj-a', []), submissions: [routedFill('xgs:a-1', VIEW_AT - 1000, '100.00')], decisions: [], readAt: VIEW_AT } },
      { kind: 'oversight-read', at: VIEW_AT, read: unconfirmedBundle() },
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: DEMO_PROJECT_ID, utilization: utilizationOf(DEMO_PROJECT_ID, []), submissions: [], decisions: [], readAt: VIEW_AT } },
    ]);
  }

  it('THE S1 SHAPE: a present-but-empty bundle folds the row to the honest absence — read null, EVERY cockpit field null (never fills 0 / net 0 as knowns)', () => {
    const row = oversightRowsOf(s1WindowState(), VIEW_AT).find((candidate) => candidate.projectId === 'prj-b');
    if (row === undefined) throw new Error('prj-b is not in the fold');
    expect(row.read).toBeNull(); // the all-empty bundle is NOT a read on record — the fold never treats an unconfirmed read as a positive zero
    expect(row.cockpit).toEqual({
      openPositions: null, netExposure: null, feeTotal: null,
      fills: null, refusals: null, decisions: null, breaches: null,
    });
  });

  it('THE FABRICATED SUM, DEAD: the roll-up reads UNKNOWN on every blotter field and names the unconfirmed desk — never the understated known sum S1 saw', () => {
    const aggregate = oversightAggregateOf(s1WindowState(), VIEW_AT);
    // pre-fix: netExposureTotal '100.00' — prj-a's true 100.00 + prj-b's
    // FABRICATED 0 + the demo desk's confirmed 0, a KNOWN sum understated
    // by exactly prj-b's true 1,053.75 (the register's 66,451.725-vs-
    // 67,505.475 class). The law: unknown, never a sum over the gap.
    expect(aggregate.netExposureTotal).toBeNull();
    expect(aggregate.openPositions).toBeNull();
    expect(aggregate.fills).toBeNull();
    expect(aggregate.refusals).toBeNull();
    expect(aggregate.decisions).toBeNull();
    expect(aggregate.breaches).toBeNull();
    expect(aggregate.desksWithoutRead).toBe(1);      // prj-b — the unconfirmed bundle counts as no read, NAMED
    expect(aggregate.desksWithoutStandingRead).toBe(0);
  });

  it('a CONFIRMED empty read keeps its positive zeros — the standing read answered, so the empty blotter is the host\'s own claim (the demo-desk shape)', () => {
    const row = oversightRowsOf(s1WindowState(), VIEW_AT).find((candidate) => candidate.projectId === DEMO_PROJECT_ID);
    if (row === undefined) throw new Error('the demo desk is not in the fold');
    expect(row.read).not.toBeNull();
    expect(row.cockpit).toEqual({
      openPositions: 0, netExposure: '0', feeTotal: '0',
      fills: 0, refusals: 0, decisions: 0, breaches: 0,
    });
  });

  it('any ONE confirmed element makes the bundle a read (per-field honesty: a confirmed org snapshot, a single submission, or a single decision each carries the desk past the absence gate)', () => {
    const orgOnly: OversightDeskRead = { projectId: 'prj-b', utilization: null, submissions: [], decisions: [], readAt: VIEW_AT, orgStatus: { organizationRef: 'org:b', tenant: 'tenant-a', project: 'prj-b', status: 'forming', at: VIEW_AT - 1000, instanceRefs: [] } };
    const orgRow = oversightRowsOf(reduceAll(oversightWorkspace(), [{ kind: 'oversight-read', at: VIEW_AT, read: orgOnly }]), VIEW_AT).find((candidate) => candidate.projectId === 'prj-b');
    if (orgRow === undefined) throw new Error('prj-b is not in the fold');
    expect(orgRow.read).not.toBeNull();              // the org route confirmed the desk
    expect(orgRow.orgStatus).toBe('forming');
    expect(orgRow.cockpit.netExposure).toBe('0');    // the confirmed bundle's empty blotter stays a positive 0
    expect(orgRow.cockpit.breaches).toBeNull();      // the standing read still did not answer — per-field honesty
    const oneFill: OversightDeskRead = { projectId: 'prj-b', utilization: null, submissions: [routedFill('xgs:b-1', VIEW_AT - 1000, '1053.75')], decisions: [], readAt: VIEW_AT };
    const fillRow = oversightRowsOf(reduceAll(oversightWorkspace(), [{ kind: 'oversight-read', at: VIEW_AT, read: oneFill }]), VIEW_AT).find((candidate) => candidate.projectId === 'prj-b');
    if (fillRow === undefined) throw new Error('prj-b is not in the fold');
    expect(fillRow.read).not.toBeNull();             // the blotter route confirmed the desk
    expect(fillRow.cockpit.netExposure).toBe('1053.75');
    expect(fillRow.cockpit.breaches).toBeNull();
    const oneDecision: OversightDeskRead = { projectId: 'prj-b', utilization: null, submissions: [], decisions: [decision('b-1', VIEW_AT - 500)], readAt: VIEW_AT };
    const decisionRow = oversightRowsOf(reduceAll(oversightWorkspace(), [{ kind: 'oversight-read', at: VIEW_AT, read: oneDecision }]), VIEW_AT).find((candidate) => candidate.projectId === 'prj-b');
    if (decisionRow === undefined) throw new Error('prj-b is not in the fold');
    expect(decisionRow.read).not.toBeNull();         // the decision stream confirmed the desk
    expect(decisionRow.cockpit.decisions).toBe(1);
  });

  it('THE RECOVERY (the register: "recovered on reload"): a confirmed re-read replaces the unconfirmed bundle and the desk\'s true book returns to the roll-up at exact decimals', () => {
    const recovered = reduceAll(s1WindowState(), [
      { kind: 'oversight-read', at: VIEW_AT + 1, read: { projectId: 'prj-b', utilization: utilizationOf('prj-b', []), submissions: [routedFill('xgs:b-true', VIEW_AT - 2000, '1053.75')], decisions: [], readAt: VIEW_AT + 1 } },
    ]);
    const aggregate = oversightAggregateOf(recovered, VIEW_AT);
    expect(aggregate.netExposureTotal).toBe('1153.75'); // 100.00 + 1053.75 + 0 — exact, the true book restored (never the pre-fix understated 100.00)
    expect(aggregate.fills).toBe(2);
    expect(aggregate.desksWithoutRead).toBe(0);
    expect(aggregate.breaches).toBe(0);                 // every standing read now on record too
  });
});
