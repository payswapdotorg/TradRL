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
import { oversightRowsOf, oversightScopeNoteOf, type OversightDeskRead } from './oversight';
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
    expect(oversightScopeNoteOf(state)).toContain('3 desks');
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
