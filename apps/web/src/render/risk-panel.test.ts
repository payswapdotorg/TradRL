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
  it('renders one row per constraint: the bound, the current number, and the honest ok/breach/unknown verdict — the unknown rendered AS unknown, never a fabricated zero', () => {
    const bytes = renderBytes(riskState(utilizationRead()));
    expect(bytes).toContain('Standing utilization');
    expect(bytes).toContain('k-capital');
    expect(bytes).toContain('91,250.375'); // the current number, grouped — the one-glance answer
    expect(bytes).toContain('300,000,000'); // the bound
    expect(bytes).toContain('k-position');
    expect(bytes).toContain('unknown — no defensible number on file'); // the honest unknown
    expect(bytes).toContain('>ok<'); // the status pill labels render
    expect(bytes).toContain('>unknown<');
    // each row's own source disclosure is available on the surface
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

  it('states the L4 current-instant law on the surface (the read is NOT projected to the view instant) and carries the honesty disclosure', () => {
    const bytes = renderBytes(riskState(utilizationRead()));
    expect(bytes).toContain('Standing read as of 2026-10-08T05:00:00.000Z');
    expect(bytes).toContain('not projected to the view instant');
    expect(bytes).toContain('THE HONESTY LAW');
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
    // the standing bounds above keep their own current-instant law (never a faked point-in-time meter)
    expect(bytes).toContain('not projected to the view instant');
  });

  it('the standing bounds themselves are NOT projected (the read\'s own asOf stays the law — only the breach ROWS project)', () => {
    const bytes = renderBytes(riskState(utilizationRead()));
    expect(bytes).toContain('Standing read as of 2026-10-08T05:00:00.000Z');
    expect(bytes).toContain('91,250.375'); // the standing current, served verbatim — never re-derived from the view instant
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

describe('FW-37-B (F-7): the violation row labels the projection and shows the standing book beside it', () => {
  it('the refused candidate\'s projected value is LABELED as the projection, and the matching bound\'s standing current renders beside it (S3\'s 184,859.99-vs-4,860 card, closed)', () => {
    const read = utilizationRead({ activeBreaches: [{
      kind: 'risk_limits_refusal',
      submissionId: 'xgs:capital-refusal',
      auditId: 'xga:capital-refusal',
      stage: 'risk_limits',
      at: '2026-10-07T14:03:00.000Z',
      decisionBody: 'gate:pre-trade-risk',
      violations: [{ constraintId: 'k-capital', domain: 'outcome', subject: 'capital.budget', severity: 'blocking', predicate: { kind: 'limit.max', bound: 300000000 }, observed: '184859.99' }],
      rationale: 'The order was refused at the risk-limits stage.',
    }] });
    const bytes = renderBytes(riskState(read));
    expect(bytes).toContain('vs projected 184859.99'); // the gate's own arithmetic, labeled as the projection
    expect(bytes).toContain('standing book on file');  // the actual book renders beside it
    expect(bytes).toContain('91,250.375 · ok (the standing utilization row above)'); // the bound's own current + verdict, traceable up the card
    // the pre-fix misreading is structurally gone: the observed value never renders unlabeled
    expect(bytes).not.toContain('observed 184859.99');
  });

  it('a violation whose bound has NO defensible standing current renders the labeled projection alone (never a fabricated standing book)', () => {
    const bytes = renderBytes(riskState(utilizationRead())); // the k-position violation: its bound's current is null (unknown)
    expect(bytes).toContain('vs projected 2.4');
    expect(bytes).not.toContain('standing book on file'); // no standing number on file — the row stays absent, never a zero
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

  it('with NO evaluations on file the sentence names the gate-evaluable subjects honestly and points at the card — never a fabricated verdict, never the blanket claim', () => {
    const bytes = renderBytes(riskState(null)); // no read, no blotter rows
    expect(bytes).toContain('data-risk-enforcement="true"');
    expect(bytes).toContain('not by this list'); // the honest framing: the LIST does not decide what binds
    expect(bytes).toContain('the notional/budget subjects (book.notional, capital.budget, order.notional) and the realized-cumulative subjects (risk.budget, risk.maxDrawdown) bind where derivable');
    expect(bytes).toContain('every other class is taught, not enforced');
    expect(bytes).not.toContain('data-risk-evaluations="true"'); // the card renders only when verdicts are on file
    expect(bytes).not.toContain('enforced at the pre-trade gate'); // the pre-fix overclaim is gone on every branch
  });
});
