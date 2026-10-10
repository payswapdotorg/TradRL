// Tests for THE STANDING RISK-UTILIZATION PANEL (FW-32-A, Round A blocker
// 1 — risk_tooling, the ONLY dimension Round A scored a LOSS): the Risk
// section renders the FW-31-A host-owned read's payload — per-bound
// standing utilization (boundMax + current + the honest ok/breach/unknown
// verdict, the unknown rendered AS unknown), the active-breach list
// (bound-vs-observed, audit refs, instants) and the disclosure — with the
// L4 current-instant law stated on the surface (the read is NOT projected
// to the Time Machine's view instant; point-in-time risk is never faked).
//
// Also pins: the reducer's scope gate (a read of another project never
// enters the state — L12), the honest pre-read absence (a teaching note,
// never a fabricated meter), and the read's replacement semantics (the
// state mirrors THIS scope's latest serve).
//
// FW-37-B pins (Round F register F-1 UI half + F-6 + F-7):
//   - F-6: the breaches panel is the VIEW-INSTANT projection of the
//     standing read's own breach rows (a refusal observed in the future
//     of a scrubbed instant never renders — the same L4 law
//     Research/Decisions/Execution ride; M2 found the leak, M3
//     reproduced it);
//   - F-7: a violation's "observed" is labeled unmistakably as the
//     REFUSED candidate's own projection, with the standing book on
//     file beside it (S3's CIO-confusing card read as a 184,859.99
//     standing breach against an actual book of 4,860);
//   - F-1 (UI half): the Risk card's enforcement claim renders from the
//     boundary's OWN per-constraint verdicts (the served blotter's
//     additive limitsEvaluation rows — the same truth surface the
//     export serves), and the gate-evaluable/not-gate-evaluable split
//     is taught BY NAME in the UI (the E-2 teaching, no longer
//     export-only), never the pre-fix blanket "enforced at the
//     pre-trade gate" overclaim.

import { describe, expect, it } from 'vitest';
import type { ConstraintSetStatement, GatewaySubmissionRecord, GoalStatement, RiskUtilizationRead } from '../api/contracts';
import { openWorkspace, reduceAll, type WorkspaceEvent } from '../core/workspace';
import { renderConsoleModel } from './model';
import { defaultShellView } from './shell';
import { serializeVNode } from './vtree';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
// FW-37-B (F-6) fixture justification: the epoch moved so the workspace's
// VIEW INSTANT (the open anchor, live mode) sits AFTER the read's own
// breach instant — the panel is now the view-instant projection (F-6),
// and the row-render pins need a breach OBSERVED BY the view instant to
// pin what a rendered breach row carries. The pre-fix panel rendered
// every refusal on file at ANY instant — that behavior is GONE and is
// pinned as gone in the F-6 describe below.
const T0 = 1_800_000_000_000; // 2027-01-15T11:40:00.000Z — after the read's own 2026 records

function goalLoaded(): WorkspaceEvent {
  const goal = { id: 'goal-1', version: 1, tenantId: 'tenant-a', objective: 'operate inside the envelope', horizon: { startsAt: T0, endsAt: T0 + 86_400_000, label: null }, successCriteria: { requiredSatisfaction: 1, criteria: [] }, evaluation: { adversarialRequired: false }, createdAt: T0 } as unknown as GoalStatement;
  const constraintSet = {
    id: 'cs-1', version: 1, tenantId: 'tenant-a', name: 'the test constraint set',
    constraints: [
      { id: 'k-capital', domain: 'outcome', subject: 'capital.budget', predicate: { kind: 'equals', value: 300000000 }, severity: 'blocking', description: '' },
      { id: 'k-position', domain: 'state', subject: 'position.grossExposure', predicate: { kind: 'limit.max', bound: 2 }, severity: 'blocking', description: '' },
    ],
    createdAt: T0,
  } as unknown as ConstraintSetStatement;
  return { kind: 'goal-loaded', at: T0 + 1, goal, constraintSet };
}

function utilizationRead(overrides: Partial<RiskUtilizationRead> = {}): RiskUtilizationRead {
  return {
    projectId: 'proj-a',
    asOf: '2026-10-08T05:00:00.000Z',
    bounds: [
      { constraintId: 'k-capital', metric: 'capital.budget', boundMax: '300000000', severity: 'blocking', current: 91250.375, source: 'the cumulative gross filled notional of the 2 routed fill(s) on record', status: 'ok' },
      { constraintId: 'k-position', metric: 'position.grossExposure', boundMax: '2', severity: 'blocking', current: null, source: 'no position or equity store exists on any backing — a standing exposure cannot be derived from per-trade fills without fabricating a book', status: 'unknown' },
    ],
    activeBreaches: [
      {
        kind: 'risk_limits_refusal',
        submissionId: 'xgs:demo0003',
        auditId: 'xga:demo0003',
        stage: 'risk_limits',
        at: '2026-10-07T14:03:00.000Z',
        decisionBody: 'gate:pre-trade-risk',
        violations: [{ constraintId: 'k-position', domain: 'state', subject: 'position.grossExposure', severity: 'blocking', predicate: { kind: 'limit.max', bound: 2 }, observed: '2.4' }],
        rationale: 'The order was refused at the risk-limits stage: projected gross exposure 2.4 exceeds the blocking limit.max bound 2.',
      },
    ],
    disclosure: 'THE HONESTY LAW: every bounds[].current is computed ONLY from the records named in its source; where the data on file cannot produce a defensible number the row serves current null with status "unknown".',
    ...overrides,
  };
}

function riskState(read: RiskUtilizationRead | null): ReturnType<typeof openWorkspace> {
  const events: WorkspaceEvent[] = [
    goalLoaded(),
    { kind: 'section-selected', at: T0 + 2, section: 'risk' },
    ...(read === null ? [] : [{ kind: 'risk-utilization-loaded', at: T0 + 3, read } as WorkspaceEvent]),
  ];
  return reduceAll(openWorkspace(SCOPE, T0), events);
}

function renderBytes(state: ReturnType<typeof openWorkspace>): string {
  return serializeVNode(renderConsoleModel(state, T0 + 50, { ...defaultShellView(state), accountView: 'section' }));
}

describe('the Risk section\'s standing utilization panel (FW-32-A, Round A blocker 1)', () => {
  it('renders one row per constraint: the bound, the FILL-DERIVED standing number, and the honest ok/breach/unknown verdict — the unknown rendered AS unknown, never a fabricated zero', () => {
    // FW-38-B (G-2) pin update, justified: the standing number is no
    // longer the read's own `current` (the boundary's precedence-1 LAST
    // GATE OBSERVATION — the refused candidate's projection) but the
    // desk's own fill-derived book at the view instant; the read's own
    // number still renders, labeled as what it is (the served read /
    // the last gate observation — never the standing book).
    const bytes = renderBytes(riskState(utilizationRead()));
    expect(bytes).toContain('Standing utilization (the fill-derived book)');
    expect(bytes).toContain('capital.budget (bound 300,000,000)');
    expect(bytes).toContain('300,000,000'); // the bound
    expect(bytes).toContain('standing (fill-derived book)');
    expect(bytes).toContain('served read');
    expect(bytes).toContain('91,250.375 · ok'); // the boundary's own fill-derived sum, rendered verbatim beside the standing rows
    expect(bytes).toContain('position.grossExposure (bound 2)');
    expect(bytes).toContain('0 · ok'); // the standing open-position count (no fills in the console's blotter at this view instant) — never a fabricated "unknown"
    expect(bytes).toContain('>ok<'); // the status pill labels render
    // the read's own source disclosures stay on the surface
    expect(bytes).toContain('without fabricating a book');
  });

  it('renders the active-breach aggregation: bound-vs-projected, the audit ref, the instant, the deciding body', () => {
    // FW-37-B (F-6 + F-7) pin update, justified: the title now names the
    // VIEW-INSTANT count ("at this view instant" — the L4 projection the
    // panel performs), and the violation's observed value is labeled as
    // the REFUSED candidate's own projection (F-7: it was the gate's
    // pre-trade arithmetic, never the standing book — the label now
    // says so on the surface). The row's own content (audit ref, stage,
    // subject, deciding body) is unchanged law.
    const bytes = renderBytes(riskState(utilizationRead()));
    expect(bytes).toContain('Active breaches (1 at this view instant)');
    expect(bytes).toContain('xgs:demo0003');
    expect(bytes).toContain('risk-limits refusal');
    expect(bytes).toContain('position.grossExposure');
    expect(bytes).toContain('vs projected 2.4'); // F-7: the projection is labeled, never read as the standing book
    expect(bytes).toContain("(the refused candidate's own projection — what the gate refused, not the standing book)");
    expect(bytes).toContain('xga:demo0003');
    expect(bytes).toContain('gate:pre-trade-risk');
    expect(bytes).toContain('2026-10-07T14:03:00.000Z'); // the breach's own observed instant, verbatim
  });

  it('states the as-of law on the surface: the DATA\'S OWN AS-OF (never the read-capture instant) and the honesty disclosure', () => {
    // FW-38-B (G-12) pin update, justified: "Standing read as of" cited
    // the read-capture instant (the served asOf — the moment the route
    // ran); the footer now cites the data's own as-of (the newest fill
    // or refusal observation the rows derive from) and names the
    // read-capture instant separately, labeled as what it is.
    const bytes = renderBytes(riskState(utilizationRead()));
    expect(bytes).toContain('The read itself was captured at 2026-10-08T05:00:00.000Z (the read-capture instant, not the data\'s as-of)');
    expect(bytes).toContain('the data\'s own as-of');
    expect(bytes).toContain('THE HONESTY LAW');
  });

  it('FW-38-B (G-8, consumed defensively): a read carrying the desk-level ENTRY-BLOCKED status renders the loud cause before the standing rows; absent/null renders nothing (graceful degradation)', () => {
    // The FW-38-A runtime contract (PR #81) — data.entryBlocked = the
    // named blocking constraint whose class makes every entry candidate
    // inadmissible BY CONSTRUCTION. L2's D1: a blocking concentration
    // 0.25 killed the desk at entry for 38+ minutes with 0 fills / 0
    // refusals / 0 decisions and NO surface explaining why — this panel
    // is one of the two surfaces that now names the cause (the Oversight
    // desk card is the other, pinned in render/oversight.test.ts).
    const blocked = utilizationRead({ entryBlocked: {
      status: 'entry-blocked',
      constraintId: 'k-concentration',
      domain: 'state',
      subject: 'position.concentration',
      gateClass: 'position_concentration',
      predicateKind: 'limit.max',
      bound: '0.25',
      severity: 'blocking',
      reason: 'the first candidate is 100% of the projected book (candidate / (0 + candidate) = 1, whatever its size) and 1 > 0.25, so no candidate can ever be admissible until the constraint is revised',
    } });
    const blockedBytes = renderBytes(riskState(blocked));
    expect(blockedBytes).toContain('data-risk-entry-blocked="true"');
    expect(blockedBytes).toContain('this desk cannot enter: the first candidate is 100% of the projected book');
    expect(blockedBytes).toContain('position.concentration · limit.max bound 0.25, blocking — constraint k-concentration');
    // GRACEFUL DEGRADATION, pinned both ways: the default fixture carries
    // NO entryBlocked field (a backing that predates the contract) and an
    // explicit null serves "no structural cause on record" — neither
    // renders anything, neither fabricates a cause.
    expect(renderBytes(riskState(utilizationRead())).includes('this desk cannot enter')).toBe(false);
    expect(renderBytes(riskState(utilizationRead({ entryBlocked: null }))).includes('this desk cannot enter')).toBe(false);
  });

  it('renders the honest zero-breach state as the absence it is (never a fabricated all-clear)', () => {
    // FW-37-B (F-6) pin update, justified: the title names the view-instant
    // count — the pre-fix "Active breaches (0)" became "Active breaches
    // (0 at this view instant)"; the honest no-refusal note is unchanged.
    const read = utilizationRead({ activeBreaches: [] });
    const bytes = renderBytes(riskState(read));
    expect(bytes).toContain('Active breaches (0 at this view instant)');
    expect(bytes).toContain('No refusal is on file for this project — nothing stands in breach.');
  });

  it('renders the honest pre-read absence as a teaching note when no read is on record (never a fabricated meter)', () => {
    const bytes = renderBytes(riskState(null));
    expect(bytes).toContain('No standing utilization read is on record for this scope');
    expect(bytes).not.toContain('Standing utilization'); // no panel without a read
  });

  it('the reducer: a read of ANOTHER project never enters the state (L12 — the typed scope gate)', () => {
    const foreign = utilizationRead({ projectId: 'proj-other' });
    expect(() => riskState(foreign)).toThrow(/own project scope/);
  });

  it('the reducer: a later read REPLACES the prior one wholesale (the state mirrors the latest serve)', () => {
    const first = riskState(utilizationRead());
    expect(first.riskUtilization?.activeBreaches).toHaveLength(1);
    const second = reduceAll(first, [{ kind: 'risk-utilization-loaded', at: T0 + 10, read: utilizationRead({ activeBreaches: [] }) }]);
    expect(second.riskUtilization?.activeBreaches).toHaveLength(0); // replaced, never merged
  });

  it('a scope adoption CLEARS the standing read (the panel never bleeds across desks)', () => {
    const state = riskState(utilizationRead());
    const adopted = reduceAll(state, [{ kind: 'project-adopted', at: T0 + 20, projectId: 'proj-b' }]);
    expect(adopted.riskUtilization).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FW-37-B (Round F register F-6): the Risk "Active breaches" panel is the
// VIEW-INSTANT projection of the standing read's own breach rows. The
// pre-fix panel rendered EVERY refusal on file at ANY Time Machine instant
// — a refusal observed in the FUTURE of a scrubbed instant leaked into
// the past view (M2 found it, M3 reproduced it: "the Risk panel showed a
// refusal that had not happened yet at the instant under review").
// Research/Decisions/Execution project correctly; Risk now rides the same
// L4 law. The standing BOUNDS keep their own current-instant law (the
// asOf note) — point-in-time utilization is not computable, never faked.
// ---------------------------------------------------------------------------

describe('FW-37-B (F-6): the breaches panel is the view-instant projection (the future-refusal leak, closed)', () => {
  it('a breach observed AFTER the view instant never renders — the title counts the view instant and the note names what is withheld (L4)', () => {
    // one breach observed BY the view instant, one AFTER it, one unparseable —
    // only the first renders; the note names the two withheld honestly.
    const read = utilizationRead({ activeBreaches: [
      { ...utilizationRead().activeBreaches[0] as Exclude<RiskUtilizationRead['activeBreaches'][number], never>, submissionId: 'xgs:past', at: '2026-10-07T14:03:00.000Z' },
      { ...utilizationRead().activeBreaches[0] as Exclude<RiskUtilizationRead['activeBreaches'][number], never>, submissionId: 'xgs:future', at: '2027-06-01T00:00:00.000Z' },
      { ...utilizationRead().activeBreaches[0] as Exclude<RiskUtilizationRead['activeBreaches'][number], never>, submissionId: 'xgs:unreadable', at: 'not-an-instant' },
    ] });
    const bytes = renderBytes(riskState(read));
    expect(bytes).toContain('Active breaches (1 at this view instant)');
    expect(bytes).toContain('data-risk-breach="xgs:past"');     // the observed-by-view row renders
    expect(bytes).not.toContain('data-risk-breach="xgs:future"'); // the FUTURE refusal never renders (M3's leak)
    expect(bytes).not.toContain('data-risk-breach="xgs:unreadable"'); // an unparseable instant is excluded, never guessed past
    expect(bytes).toContain('data-risk-breach-projection="true"'); // the withholding note renders
    expect(bytes).toContain('2 standing breaches observed after (or unparseable against) this view instant — not shown here (L4).');
    // the standing rows themselves are the FILL-DERIVED book (G-12: the footer
    // names the read-capture instant as the capture, never the data's as-of)
    expect(bytes).toContain('the read-capture instant, not the data\'s as-of');
  });

  it('the standing rows are the FILL-DERIVED book — the read\'s own number renders beside them, labeled (never swapped for the book)', () => {
    // FW-38-B (G-2 + F-6 pin update, justified): the pre-fix "standing
    // bounds are NOT projected" pin asserted the read's own `current`
    // (91,250.375) rendered verbatim as the standing number — that WAS
    // the G-2 defect when the read's current is a gate observation. The
    // standing number is now the desk's own fills at the view instant;
    // the read's own fill-derived sum renders in its own labeled row.
    const bytes = renderBytes(riskState(utilizationRead()));
    expect(bytes).toContain('standing (fill-derived book)');
    expect(bytes).toContain('0 · ok'); // no fills in this console's blotter at the view instant — the honest empty sum
    expect(bytes).toContain('served read');
    expect(bytes).toContain('91,250.375 · ok'); // the boundary's own number, verbatim, labeled
  });
});

// ---------------------------------------------------------------------------
// FW-37-B (Round F register F-7): the standing breach card's violation
// "observed" is the REFUSED candidate's own projection (the pre-trade
// arithmetic the gate refused), never the standing book. S3's
// reproduction: the K-CAPITAL-BUDGET breach card showed 184,859.99 as the
// book while the actual standing book was 4,860 — a CIO could read a
// standing breach where only a refused projection stood. The card now
// labels the projection unmistakably AND renders the standing book on
// file beside it.
// ---------------------------------------------------------------------------

describe('FW-37-B (F-7) + FW-38-B (G-2): the violation row labels the projection and shows the FILL-DERIVED standing book beside it', () => {
  /** Two compliant fills summing 4,860 — S3's exact ground truth. */
  function fillsSumming4860(): GatewaySubmissionRecord[] {
    const fill = (id: string, notional: string): GatewaySubmissionRecord => ({
      kind: 'routed', submissionId: id, decisionId: `xd:${id}`, auditId: `xga:${id}`, requestRef: `gor:${id}`,
      venue: 'binance', adapterRef: 'adapter', channelRef: 'channel', routedAt: T0 - 5000,
      fill: { state: 'filled', quantity: '1', price: '100', notional, fee: '0.10', filledAt: T0 - 5000 },
    });
    return [fill('xgs:s3-1', '2430.00'), fill('xgs:s3-2', '2430.00')];
  }

  it('THE G-2 PIN (S3\'s card): 2 compliant fills + 1 refused candidate — the standing book beside the projection is the FILL-DERIVED 4,860 · ok, never the projected 184,859.99', () => {
    const read = utilizationRead({
      bounds: [
        { constraintId: 'k-capital', metric: 'capital.budget', boundMax: '300000000', severity: 'blocking', current: 184859.99, source: 'the risk-limits refusal xgs:capital-refusal (audit xga:capital-refusal) observed at ... — a point-in-time gate observation', status: 'breach' },
      ],
      activeBreaches: [{
        kind: 'risk_limits_refusal',
        submissionId: 'xgs:capital-refusal',
        auditId: 'xga:capital-refusal',
        stage: 'risk_limits',
        at: '2026-10-07T14:03:00.000Z',
        decisionBody: 'gate:pre-trade-risk',
        violations: [{ constraintId: 'k-capital', domain: 'outcome', subject: 'capital.budget', severity: 'blocking', predicate: { kind: 'limit.max', bound: 300000000 }, observed: '184859.99' }],
        rationale: 'The order was refused at the risk-limits stage.',
      }],
    });
    const events: WorkspaceEvent[] = [
      goalLoaded(),
      { kind: 'section-selected', at: T0 + 2, section: 'risk' },
      { kind: 'risk-utilization-loaded', at: T0 + 3, read },
      ...fillsSumming4860().map((submission): WorkspaceEvent => ({ kind: 'submission-recorded', at: T0 + 4, submission })),
    ];
    const bytes = renderBytes(reduceAll(openWorkspace(SCOPE, T0), events));
    expect(bytes).toContain('vs projected 184859.99'); // the gate's own arithmetic, labeled as the projection
    expect(bytes).toContain('standing book (fill-derived)');
    expect(bytes).toContain('4,860 · ok — the desk\'s own fills at this view instant, never the gate\'s projection'); // S3's card, closed: the book IS the book
    // the standing row itself reads the fills' book — never the projection, never a false breach
    expect(bytes).toContain('standing (fill-derived book)');
    expect(bytes).toContain('4,860 · ok');
    expect(bytes).not.toContain('4,860 · breach');
    // the projection NEVER renders AS the standing value (it may render ONLY in its own labeled observation row)
    expect(bytes).not.toContain('fill-derived book)</span><span class="fact-value">184,859.99');
    // the pre-fix misreading is structurally gone: the observed value never renders unlabeled
    expect(bytes).not.toContain('observed 184859.99');
  });

  it('a violation whose bound has NO fill-derived class still renders the labeled projection alone (never a fabricated standing book)', () => {
    // FW-38-B (G-2) pin update, justified: the k-position violation's
    // "standing" is now the fill count (the open-position class IS
    // fill-derived); with NO fills in this console's blotter the honest
    // book is 0 — the pre-fix "no standing number on file" pin asserted
    // the read's null `current`, which was the G-2 defect's twin (the
    // read's unknown standing in for the book while the blotter
    // plainly carries its own counts).
    const bytes = renderBytes(riskState(utilizationRead()));
    expect(bytes).toContain('vs projected 2.4');
    expect(bytes).toContain('the desk\'s own fills at this view instant');
  });
});

// ---------------------------------------------------------------------------
// FW-37-B (Round F register F-1, UI half): the Risk card's enforcement
// claim renders from the boundary's OWN per-constraint verdicts — the
// served blotter's additive limitsEvaluation rows (the same truth surface
// the export serves since FW-36-A). The pre-fix card said "enforced at
// the pre-trade gate" over classes the gate honestly stamps
// not_gate_evaluable (S3/M3/L3: the export's own verdicts contradicted
// the card). The TRUE split now renders BY NAME, the per-constraint
// verdicts render in their own card, and the accepted-domains teaching
// (what WOULD make a bound gate-evaluable) is IN the UI — no longer
// export-only.
// ---------------------------------------------------------------------------

describe('FW-37-B (F-1, UI half): the honest enforcement sentence + the gate evaluation card', () => {
  /** One routed fill carrying the boundary's own limitsEvaluation rows (the additive FW-36-A surface, served verbatim). */
  function fillWithEvaluations(): GatewaySubmissionRecord {
    return {
      kind: 'routed', submissionId: 'xgs:eval-1', decisionId: 'xd:eval-1', auditId: 'xga:eval-1', requestRef: 'gor:eval-1',
      venue: 'binance', adapterRef: 'adapter', channelRef: 'channel', routedAt: T0 - 1000,
      fill: { state: 'filled', quantity: '1', price: '100', notional: '100.00', fee: '0.10', filledAt: T0 - 1000 },
      limitsEvaluation: [
        { constraintId: 'k-capital', domain: 'outcome', subject: 'capital.budget', severity: 'blocking', predicate: { kind: 'equals', value: '300000000' }, basis: 'projected_book_notional', derivable: true, observed: '91250.375', arithmetic: 'prior 91150.375 + candidate 100 = 91250.375', verdict: 'pass', note: 'the projected cumulative book of every routed fill on record' },
        { constraintId: 'k-position', domain: 'state', subject: 'position.grossExposure', severity: 'blocking', predicate: { kind: 'limit.max', bound: 2 }, basis: 'none', derivable: false, observed: null, arithmetic: null, verdict: 'not_gate_evaluable', note: 'not gate-evaluable: no position or equity store exists on any backing. Gate-evaluable today: book.notional, order.notional, capital.budget (projected book / order arithmetic), risk.budget, risk.maxDrawdown (realized cumulative). Accepted constraint domains: observation | state | action | outcome.' },
      ],
    } as unknown as GatewaySubmissionRecord;
  }

  function stateWithEvaluations(): ReturnType<typeof openWorkspace> {
    return reduceAll(openWorkspace(SCOPE, T0), [
      goalLoaded(),
      { kind: 'section-selected', at: T0 + 2, section: 'risk' },
      { kind: 'submission-recorded', at: T0 + 3, submission: fillWithEvaluations() },
    ]);
  }

  it('the enforcement sentence states the TRUE split by name — binding at the gate vs taught-not-enforced — never the blanket overclaim', () => {
    const bytes = renderBytes(stateWithEvaluations());
    expect(bytes).toContain('data-risk-enforcement="true"');
    expect(bytes).toContain('binding at the gate — k-capital');
    expect(bytes).toContain('taught, not enforced (not gate-evaluable) — k-position');
    // the accepted-domains teaching is IN the UI (the E-2 gap: export-only before)
    expect(bytes).toContain('observation | state | action | outcome');
    // the pre-fix blanket claim never renders
    expect(bytes).not.toContain('enforced at the pre-trade gate');
  });

  it('the gate evaluation card renders every per-constraint verdict with its basis, observed value and the boundary\'s own note (the export\'s truth surface, in the product)', () => {
    const bytes = renderBytes(stateWithEvaluations());
    expect(bytes).toContain('data-risk-evaluations="true"');
    expect(bytes).toContain('Gate evaluation (per constraint, the boundary\u2019s own verdicts)');
    expect(bytes).toContain('data-gate-evaluation="k-capital"');
    expect(bytes).toContain('k-capital · projected_book_notional');
    expect(bytes).toContain('>pass<');   // the binding verdict's own pill
    expect(bytes).toContain('observed'); // the fact row label
    expect(bytes).toContain('91250.375');
    expect(bytes).toContain('data-gate-evaluation="k-position"');
    expect(bytes).toContain('>not_gate_evaluable<'); // the honest verdict, rendered as its own state
    expect(bytes).toContain('not gate-evaluable: no position or equity store exists'); // the boundary's own note, verbatim
  });

  it('G-9: with NO evaluations on file the sentence teaches the no-observations truth — never a fabricated verdict, never the stale pre-FW-37 taxonomy fallback', () => {
    // FW-38-B (Round G register G-9 — L2 + M3) pin update, justified: the
    // empty-blotter branch used to render the STALE HARDCODED pre-FW-37
    // taxonomy ("the notional/budget subjects ... bind where derivable;
    // every other class is taught, not enforced") — contradicting the
    // boundary's own cards the moment the gate binds every declared
    // class (L2's rebuilt taxonomy: BOUND AT GATE all five). The empty
    // state now says exactly what is true: NOTHING has been observed
    // yet; the taxonomy derives from the live limitsEvaluation rows.
    const bytes = renderBytes(riskState(null)); // no read, no blotter rows
    expect(bytes).toContain('data-risk-enforcement="true"');
    expect(bytes).toContain('No gate evaluations are on file for this scope yet — nothing has been observed');
    expect(bytes).toContain('the moment the blotter serves its first observation');
    // the STALE taxonomy strings never render on the empty branch
    expect(bytes).not.toContain('bind where derivable');
    expect(bytes).not.toContain('every other class is taught, not enforced');
    expect(bytes).not.toContain('data-risk-evaluations="true"'); // the card renders only when verdicts are on file
    expect(bytes).not.toContain('enforced at the pre-trade gate'); // the pre-fix overclaim is gone on every branch
  });
});
