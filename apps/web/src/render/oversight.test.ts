// Tests for render/oversight.ts — THE OVERSIGHT PANEL (FW-37-B, Round F
// register F-2 — the consolidated multi-desk oversight surface; the
// render pins: multi-desk aggregation, per-desk budget rows, the
// per-row SIMULATED tag (the E-8 row-disclosure law), the DEMO chip on
// the teaching desk, the L4 view-instant counts, the single-desk
// teaching note, and the honest empty state).
//
// The panel renders through renderConsoleModel — the same whole-console
// pass every section rides (the wall-clock guard, the scaffold, the
// nav) — at the Oversight landing target.

import { describe, expect, it } from 'vitest';
import type { GatewaySubmissionRecord, OutcomeRecord, ProjectRecord, RiskUtilizationRead } from '../api/contracts';
import { DEMO_PROJECT_ID } from '../core/tenant';
import { formatInstantUtc } from '../core/format';
import { openWorkspace, reduceAll, type WorkspaceState } from '../core/workspace';
import { desksLaunchedAfterViewOf, oversightRowsOf } from '../core/oversight';
import { renderConsoleModel } from './model';
import { defaultShellView, type ShellView } from './shell';
import { authenticatedAccountPanel } from '../core/principal';
import { serializeVNode } from './vtree';

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

const decision = (id: string, at: number, project: string): OutcomeRecord => ({
  outcomeId: `out:${id}`, ordinal: 1, tenant: 'tenant-a', project,
  decision: { decisionRef: `xd:${id}`, intentRef: `si:${id}`, disposition: 'filled' },
  outcomeClass: 'entry', expectation: { expectedQuantity: null, expectedRealized: null, tolerance: '0', declaredBy: null },
  realization: { filledQuantity: '1', realizedOutcome: '1.00', feeTotal: '0.10', notionalTotal: '100.00', unrealizedAtDecision: '0' },
  deviation: { quantityShortfall: null, realizedGap: null, withinTolerance: null },
  evidence: [],
  lineage: {
    shadow: { sessionId: 's', fidelity: { mode: 'shadow', fill_origin: 'simulated' }, executionPolicy: { policyId: 'p', version: 1 }, riskPolicy: { policyId: 'p', version: 1 }, configDigests: { worldConfigHash: 'h', engineConfigHash: 'h', dataset: 'd' }, run: { runId: 'r', episodeId: 'e' }, cursor: { cursorId: 'c', position: 1 }, seed: 'seed', tenant: 'tenant-a', project },
    shadowOutcomeRef: 'shr', shadowOutcomeOrdinal: 1, shadowAsOf: at, decisionStreamPosition: 1, trajectoryRef: null, experiment: null,
  },
  asOf: at, priorChainHead: '0'.repeat(64),
});

const utilizationOf = (projectId: string): RiskUtilizationRead => ({
  projectId,
  asOf: formatInstantUtc(VIEW_AT),
  bounds: [
    { constraintId: 'k-capital-budget', metric: 'outcome.capital.budget', boundMax: '10000.00', severity: 'blocking', current: 4860, source: 'the projected cumulative book of every routed fill on record', status: 'ok' },
    { constraintId: 'k-risk-budget', metric: 'outcome.risk.budget', boundMax: '250.00', severity: 'blocking', current: null, source: 'the outcome records are not readable by this read on this backing', status: 'unknown' },
  ],
  activeBreaches: [
    { kind: 'risk_limits_refusal', submissionId: 'xgs:br-1', auditId: 'xga:br-1', stage: 'risk_limits', at: formatInstantUtc(VIEW_AT - 1000), violations: [{ constraintId: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', severity: 'blocking', predicate: { kind: 'limit.max', bound: 10000 }, observed: '184859.99' }] },
    { kind: 'risk_limits_refusal', submissionId: 'xgs:br-2', auditId: 'xga:br-2', stage: 'risk_limits', at: formatInstantUtc(VIEW_AT + 5000), violations: [{ constraintId: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', severity: 'blocking', predicate: { kind: 'limit.max', bound: 10000 }, observed: '99999.00' }] },
  ],
  disclosure: 'the read\'s own disclosure',
});

function oversightState(): WorkspaceState {
  // the workspace opens AT the view instant (the live anchor IS the view —
  // the fold's L4 projection counts what was knowable BY then)
  return reduceAll(openWorkspace({ tenantId: 'tenant-a', projectId: 'prj-a' }, VIEW_AT), [
    { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
    { kind: 'projects-listed', at: T0 + 1, records: [
      project('prj-a', 'Alpha Desk', 'session-owned'),
      project('prj-b', 'Beta Desk', 'session-owned'),
      project(DEMO_PROJECT_ID, 'the TradRL demo project', 'tenant-available'),
    ] },
    { kind: 'oversight-read', at: VIEW_AT, read: { projectId: 'prj-a', utilization: utilizationOf('prj-a'), submissions: [routedFill('xgs:a-1', VIEW_AT - 1000), routedFill('xgs:a-future', VIEW_AT + 9999)], decisions: [decision('a1', VIEW_AT - 500, 'prj-a')], readAt: VIEW_AT } },
    { kind: 'oversight-read', at: VIEW_AT, read: { projectId: 'prj-b', utilization: null, submissions: [], decisions: [], readAt: VIEW_AT } },
  ]);
}

const oversightBytes = (state: WorkspaceState, view: Partial<ShellView> = {}): string =>
  serializeVNode(renderConsoleModel(state, VIEW_AT, { ...defaultShellView(state), simulated: true, accountView: 'oversight', ...view }));

describe('FW-37-B (F-2): the oversight panel render', () => {
  it('renders the scaffold + one card per session-own desk (the multi-desk aggregation — M1\'s "four project switches instead of one Launchpad monitor", closed)', () => {
    const bytes = oversightBytes(oversightState());
    expect(bytes).toContain('data-scaffold="oversight"');
    expect(bytes).toContain('<h1 class="page-title">Oversight</h1>');
    expect(bytes).toContain('Every desk in this workspace, one governed view.');
    expect(bytes).toContain('data-oversight-desk="prj-a"');
    expect(bytes).toContain('data-oversight-desk="prj-b"');
    expect(bytes).toContain('data-oversight-desk="prj-demo-console"');
    expect(bytes).toContain('Alpha Desk');
    expect(bytes).toContain('Beta Desk');
    // the scope note states the governed boundary (L2: "no governed consolidation" — now there is one)
    expect(bytes).toContain("One governed view of this session's own desks");
  });

  it('the per-desk card renders the STANDING ROWS as the FILL-DERIVED BOOK (bound + standing + the labeled gate observation) in the card language (card-title + factRows)', () => {
    // FW-38-B (G-2) pin update, justified: the pre-fix "(standing)" rows
    // rendered the read's own `current` — the boundary's precedence-1
    // LAST GATE OBSERVATION — as the standing utilization; the rows now
    // render the desk's own fills at the view instant, the projection
    // stays visible ONLY labeled as the last gate observation.
    const bytes = oversightBytes(oversightState());
    expect(bytes).toContain('outcome.capital.budget (bound)');
    expect(bytes).toContain('10,000'); // the bound, grouped
    expect(bytes).toContain('outcome.capital.budget (standing — fill-derived book)');
    expect(bytes).toContain('100 · ok (the desk\'s own fills at this view instant, never a gate observation)'); // the one pre-view fill's book
    expect(bytes).toContain('outcome.capital.budget (last gate observation)');
    expect(bytes).toContain('withheld — observed at'); // the newest citing refusal lands after the view instant — G-5 withholds it
    expect(bytes).toContain('outcome.risk.budget (standing — fill-derived book)');
    expect(bytes).toContain('unknown — no fill-derived number on file'); // never a fabricated zero (the realized-loss class derives from outcomes, not fills)
  });

  it('G-3: the status pill renders the desk\'s ORG operating status — never the project-record lifecycle "draft" (6+ personas)', () => {
    // L1's exact defect: every card incl. the long-compiled demo read
    // "draft" while the Goal section itself shows "organization active".
    // The fixture reproduces it exactly: prj-a's PROJECT-RECORD lifecycle
    // is "draft" while its ORGANIZATION is compiled + operating
    // ("active") — the pill must read the org status.
    const draftLifecycle = { ...project('prj-a', 'Alpha Desk', 'session-owned'), lifecycle: { projectId: 'prj-a', status: 'draft' as const, acceptanceCriteriaId: null, organizationRef: 'org:a' } };
    const state = reduceAll(oversightState(), [
      { kind: 'projects-listed', at: VIEW_AT, records: [
        draftLifecycle,
        project('prj-b', 'Beta Desk', 'session-owned'),
        project(DEMO_PROJECT_ID, 'the TradRL demo project', 'tenant-available'),
      ] },
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: 'prj-a', utilization: utilizationOf('prj-a'), submissions: [], decisions: [], readAt: VIEW_AT, orgStatus: { organizationRef: 'org:a', tenant: 'tenant-a', project: 'prj-a', status: 'active', at: VIEW_AT - 1000, instanceRefs: ['ai:director-1'] } } },
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: 'prj-b', utilization: null, submissions: [], decisions: [], readAt: VIEW_AT } },
    ]);
    const all = oversightBytes(state);
    // prj-a's org is compiled + operating: the pill reads the ORG status
    const alphaCard = all.slice(all.indexOf('data-oversight-desk="prj-a"'), all.indexOf('data-oversight-desk="prj-b"'));
    expect(alphaCard).toContain('<span class="pill-label">active</span>');  // the ORG operating status on the pill
    expect(alphaCard).not.toContain('<span class="pill-label">draft</span>'); // the lifecycle never wears the pill again
    expect(alphaCard).toContain('organization status'); // the org status keeps its own labeled fact row
    expect(alphaCard).toContain('project lifecycle');   // the lifecycle keeps its own labeled fact row (a different entity)
    expect(alphaCard).toContain('>draft<');              // the lifecycle's own labeled fact row keeps its truth — labeled, never the pill
    // a desk with no snapshot on record renders the honest absence, never a fabricated status
    const betaCard = all.slice(all.indexOf('data-oversight-desk="prj-b"'), all.indexOf('data-oversight-desk="prj-demo-console"'));
    expect(betaCard).toContain('<span class="pill-label">org not compiled</span>');
  });

  it('G-5 + G-12: a not-yet-observed projection withholds at a scrubbed instant; the footer cites the DATA\'S OWN AS-OF, never the read-capture instant', () => {
    const bytes = oversightBytes(oversightState());
    // the newest citing refusal lands AFTER the view instant — its projection withholds (the G-5 pin)
    expect(bytes).toContain('withheld — observed at');
    expect(bytes).toContain('never rendered before its observed instant');
    // G-12: the footer cites the data's own as-of (the newest fill — the one pre-view fill), the read-capture instant named separately
    expect(bytes).toContain('Standing book as of');
    expect(bytes).toContain('the data\'s own as-of: the newest fill or refusal observation the rows above derive from');
    expect(bytes).toContain('The read itself was captured at'); // the read-capture instant, labeled as the capture — never the data's as-of
    // once the view instant passes the observed instant, the observation renders — LABELED as the projection, never the standing book
    const later = reduceAll(oversightState(), [
      { kind: 'anchor-advanced', at: VIEW_AT + 10_000 }, // live mode: the view follows the fresh anchor
    ]);
    const laterBytes = oversightBytes(later);
    expect(laterBytes).toContain('never the standing book');
    expect(laterBytes).toContain("the refused candidate's projection");
  });

  it('G-8 (consumed defensively): the read\'s desk-level ENTRY-BLOCKED status renders LOUDLY — "this desk cannot enter: <reason>" + the named constraint; absent/null renders nothing (graceful degradation)', () => {
    // The FW-38-A runtime contract (PR #81), consumed by THIS wave's UI
    // half: GET /v1/risk/utilization serves data.entryBlocked = the named
    // blocking constraint whose class makes every entry candidate
    // inadmissible BY CONSTRUCTION — the dead-desk silence's (L2: 38+
    // minutes of 0/0/0; M3's D2: 18+) first explanation surface. The
    // client mirror is OPTIONAL: a backing that predates the field omits
    // it entirely and NOTHING renders (pinned below with the default
    // fixture, whose read carries no entryBlocked field at all).
    const blocked: RiskUtilizationRead = {
      ...utilizationOf('prj-a'),
      entryBlocked: {
        status: 'entry-blocked',
        constraintId: 'k-concentration',
        domain: 'state',
        subject: 'position.concentration',
        gateClass: 'position_concentration',
        predicateKind: 'limit.max',
        bound: '0.25',
        severity: 'blocking',
        reason: 'the first candidate is 100% of the projected book (candidate / (0 + candidate) = 1, whatever its size) and 1 > 0.25, so no candidate can ever be admissible until the constraint is revised',
      },
    };
    const state = reduceAll(oversightState(), [
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: 'prj-a', utilization: blocked, submissions: [], decisions: [], readAt: VIEW_AT } },
    ]);
    const all = oversightBytes(state);
    const alphaCard = all.slice(all.indexOf('data-oversight-desk="prj-a"'), all.indexOf('data-oversight-desk="prj-b"'));
    // THE LOUD RENDER: the desk cannot enter, the reason verbatim (the runtime's own entry arithmetic), the named constraint beside it
    expect(alphaCard).toContain('data-entry-blocked="prj-a"');
    expect(alphaCard).toContain('this desk cannot enter: the first candidate is 100% of the projected book');
    expect(alphaCard).toContain('no candidate can ever be admissible until the constraint is revised');
    expect(alphaCard).toContain('position.concentration · limit.max bound 0.25, blocking — constraint k-concentration');
    // the pill keeps its own G-3 law (the ORG status — 'org not compiled' here, no snapshot in this bundle) — the entry block is its own labeled surface, never a pill conflation
    expect(alphaCard).toContain('<span class="pill-label">org not compiled</span>');
    // GRACEFUL DEGRADATION, pinned: the default fixture's read carries NO entryBlocked field (a backing that predates the contract) — nothing renders
    const defaultBytes = oversightBytes(oversightState());
    expect(defaultBytes.includes('this desk cannot enter')).toBe(false);
    expect(defaultBytes.includes('data-entry-blocked')).toBe(false);
    // and a read that serves entryBlocked: null explicitly renders nothing either (no structural cause on record — never fabricated)
    const explicitNull = reduceAll(oversightState(), [
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: 'prj-a', utilization: { ...utilizationOf('prj-a'), entryBlocked: null }, submissions: [], decisions: [], readAt: VIEW_AT } },
    ]);
    expect(oversightBytes(explicitNull).includes('this desk cannot enter')).toBe(false);
  });

  it('every desk row carries the visible SIMULATED tag on the demo adapter, and the demo desk carries its own DEMO chip (the E-8 law at the new surface)', () => {
    const bytes = oversightBytes(oversightState());
    const tags = bytes.match(/data-simulated-tag="true"/g) ?? [];
    // FW-43-A pin update, justified: the count was 3 (one per desk
    // card); the cockpit wave added the CROSS-DESK AGGREGATE ROW, and
    // the E-8 law covers it too — a copied roll-up ("net exposure
    // 160.005 · 3 breaches") must never read as a production book.
    expect(tags.length).toBe(4); // one per desk row + the aggregate roll-up
    expect(bytes).toContain('data-demo-tag="true"'); // the shared teaching desk's own chip
    // a live console renders no SIMULATED tag (the mirror law)
    const live = oversightBytes(oversightState(), { simulated: false });
    expect(live.includes('data-simulated-tag')).toBe(false);
  });

  it('the per-desk counts are the VIEW-INSTANT projection (L4): a post-view fill and a post-view breach never render, and the breach note names what is withheld', () => {
    const bytes = oversightBytes(oversightState());
    expect(bytes).toContain('fills on record (view instant)');
    // prj-a: one pre-view fill, one post-view fill — only the pre-view one counts
    const alphaCard = bytes.slice(bytes.indexOf('data-oversight-desk="prj-a"'), bytes.indexOf('data-oversight-desk="prj-b"'));
    expect(alphaCard).toContain('>1<'); // fills = 1 (the pre-view fill; the post-view one is projected away)
    expect(alphaCard).toContain('>1</span>'); // decisions = 1 (the pre-view decision)
    expect(alphaCard).toContain('active breaches (view instant)');
    expect(alphaCard).toContain('1 standing breach observed AFTER this view instant'); // the F-6 note, rendered
  });

  it('a desk without a read on record renders its honest absence — never a fabricated number', () => {
    const bytes = oversightBytes(oversightState());
    const betaCard = bytes.slice(bytes.indexOf('data-oversight-desk="prj-b"'), bytes.indexOf('data-oversight-desk="prj-demo-console"'));
    // FW-44-A (L-1) pin update, justified: prj-b's fixture bundle is the
    // ALL-EMPTY shape (no standing read, no submissions, no decisions, no
    // org snapshot — the S1 window's unconfirmed read), which the fold now
    // treats as NO read on record — so the standing note reads the honest
    // absence, never "none declared in this desk's standing read" (the
    // pre-fix copy claimed a read that never answered).
    expect(betaCard).toContain('no read on record for this desk yet'); // the unconfirmed bundle is the honest absence — nothing is claimed
    expect(betaCard).toContain('No standing utilization read is on record for this desk');
    expect(betaCard).toContain('none visible at this view instant');
  });

  it('the single-desk workspace renders its teaching note (what a one-desk workspace sees)', () => {
    const single = reduceAll(openWorkspace({ tenantId: 'tenant-a', projectId: DEMO_PROJECT_ID }, T0), [
      { kind: 'projects-listed', at: T0 + 1, records: [project(DEMO_PROJECT_ID, 'the TradRL demo project', 'tenant-available')] },
    ]);
    const bytes = oversightBytes(single);
    expect(bytes).toContain('data-oversight-single="true"');
    expect(bytes).toContain('One desk so far');
  });

  it('the empty registry renders the honest teaching empty state (never a blank region); the connecting registry renders the skeleton', () => {
    const empty = reduceAll(openWorkspace({ tenantId: 'tenant-a', projectId: 'prj-a' }, VIEW_AT), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
    ]);
    const emptyBytes = oversightBytes(empty);
    expect(emptyBytes).toContain('class="empty-state"');
    expect(emptyBytes).toContain('No desks readable yet.');
    expect(emptyBytes).toContain('data-empty="No desks readable yet."');
    // while connecting with nothing on record, the skeleton renders (the §4.12 law)
    const connecting = oversightBytes(openWorkspace({ tenantId: 'tenant-a', projectId: 'prj-a' }, VIEW_AT));
    expect(connecting).toContain('data-loading="rows"');
  });

  it('the palette reaches the Oversight target (the discoverability law — the D4 100% nav coverage includes the new surface)', () => {
    // pinned fully in core/palette.test.ts (nav:oversight) — here: the
    // nav item renders in the panel's own tree (the sidebar is one click away, D1)
    const bytes = oversightBytes(oversightState());
    expect(bytes).toContain('data-target="oversight"');
  });
});

// ---------------------------------------------------------------------------
// FW-40-A (Round H register H-3 — L2's find): the concentration standing
// row on the OVERSIGHT DESK CARD — L2's reproduction noted "The false
// breach propagates to the Oversight desk card": the pre-fix card
// rendered the open-position COUNT against the concentration FRACTION
// bound ("2 · breach" on a compliant book). The card rides the same
// core/standing.ts fold as the Risk panel — the concentration row now
// renders the fill-derived FRACTION (the largest single position's
// notional share of the book), so both surfaces heal together.
// ---------------------------------------------------------------------------

describe('FW-40-A (H-3): the Oversight desk card\'s concentration row reads the FRACTION — the false breach never propagates here again', () => {
  it('L2\'s compliant book (2 fills, fraction 0.66664 <= bound 1): the card renders the fraction · ok — never "2 · breach"', () => {
    const state = reduceAll(oversightState(), [
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: 'prj-a', utilization: {
        ...utilizationOf('prj-a'),
        bounds: [
          { constraintId: 'k-concentration', metric: 'state.position.concentration', boundMax: '1', severity: 'blocking', current: null, source: 'the standing risk-utilization read serves no concentration current on this backing', status: 'unknown' },
          { constraintId: 'k-position', metric: 'state.position.grossExposure', boundMax: '2', severity: 'blocking', current: null, source: 'no position or equity store exists on any backing', status: 'unknown' },
        ],
        activeBreaches: [],
      }, submissions: [routedFill('xgs:l2-1', VIEW_AT - 3000, '599.976'), routedFill('xgs:l2-2', VIEW_AT - 2000, '300.024')], decisions: [], readAt: VIEW_AT } },
    ]);
    const bytes = oversightBytes(state);
    const alphaCard = bytes.slice(bytes.indexOf('data-oversight-desk="prj-a"'), bytes.indexOf('data-oversight-desk="prj-b"'));
    expect(alphaCard).toContain('state.position.concentration (bound)');
    expect(alphaCard).toContain('0.66664 · ok'); // the FILL-DERIVED fraction — the largest position's share of the 900 book
    expect(alphaCard).not.toContain('2 · breach'); // the count-vs-fraction lie, dead on this surface too
    expect(alphaCard).not.toContain('· breach');  // the compliant book carries no breach stamp anywhere on the card
    // the count keeps serving its own class beside the fraction (the same two-classes-two-units pin as the Risk panel)
    expect(alphaCard).toContain('state.position.grossExposure (standing — fill-derived book)');
    expect(alphaCard).toContain('2 · ok');
  });
});

// ---------------------------------------------------------------------------
// FW-40-A (Round H register H-7 — L3's find): the Oversight desk-list is
// the VIEW-INSTANT projection. L3's exact reproduction: "the Oversight
// desk-list renders Desk Two H's full card (bounds + 'organization
// status active') at an instant 3+ minutes BEFORE its launch; the counts
// stay honestly 0 but the card's identity fields leak ... the copy
// discloses that 'every count is the view-instant projection' ... but
// the desk's existence and status fields are post-instant at a
// pre-instant view." The desk-list now projects by each desk's OWN
// launch instant (the project record's createdAt): a desk launched
// after the view instant does not exist at it — no card, the census
// counts what existed, and the withholding note names what is held
// back (L4 — the same projection discipline every count rides).
// ---------------------------------------------------------------------------

describe('FW-40-A (H-7): the desk-list is the view-instant projection (a desk launched after the view never renders)', () => {
  /** Beta Desk's launch — 60s after the scrubbed view instant (L3: "a desk launched at 17:36:47 should not render at view instant 17:33:00"). */
  const LATE_LAUNCH = T0 + 70_000;
  /** The live anchor — the wall clock has moved past the late launch when the CRO scrubs back. */
  const NOW = T0 + 80_000;

  /** The workspace with Beta Desk launched at LATE_LAUNCH (Alpha + demo launched at T0, long before the scrubbed instant). */
  function stateWithLateDesk(): WorkspaceState {
    return reduceAll(openWorkspace({ tenantId: 'tenant-a', projectId: 'prj-a' }, NOW), [
      { kind: 'connection-changed', at: NOW + 1, status: 'connected' },
      { kind: 'projects-listed', at: NOW + 1, records: [
        project('prj-a', 'Alpha Desk', 'session-owned'),
        { ...project('prj-b', 'Beta Desk', 'session-owned'), createdAt: LATE_LAUNCH, updatedAt: LATE_LAUNCH },
        project(DEMO_PROJECT_ID, 'the TradRL demo project', 'tenant-available'),
      ] },
      { kind: 'oversight-read', at: NOW + 1, read: { projectId: 'prj-a', utilization: utilizationOf('prj-a'), submissions: [], decisions: [], readAt: NOW } },
      { kind: 'oversight-read', at: NOW + 1, read: { projectId: 'prj-b', utilization: null, submissions: [], decisions: [], readAt: NOW, orgStatus: { organizationRef: 'org:b', tenant: 'tenant-a', project: 'prj-b', status: 'active', at: LATE_LAUNCH, instanceRefs: ['ai:director-1'] } } },
    ]);
  }

  const bytesAt = (state: WorkspaceState, at: number): string =>
    serializeVNode(renderConsoleModel(state, at, { ...defaultShellView(state), simulated: true, accountView: 'oversight' }));

  it('a desk launched at T does NOT render its full card at the T-1min scrubbed view — and the withholding note names what is held back (L4)', () => {
    const scrubbed = reduceAll(stateWithLateDesk(), [
      { kind: 'view-timestamp', at: NOW + 2, timestamp: LATE_LAUNCH - 60_000 }, // the Time Machine scrubbed 1 minute before Beta Desk's launch
    ]);
    const bytes = bytesAt(scrubbed, NOW + 2);
    // Beta Desk did not exist at the scrubbed instant — NO card, no identity leak (L3: "the card's identity fields leak ... bounds + 'organization status active'")
    expect(bytes).not.toContain('data-oversight-desk="prj-b"');
    expect(bytes).not.toContain('Beta Desk');
    expect(bytes).not.toContain('org:b');
    // the desks that DID exist at the instant render as always
    expect(bytes).toContain('data-oversight-desk="prj-a"');
    expect(bytes).toContain('data-oversight-desk="' + DEMO_PROJECT_ID + '"');
    expect(bytes).toContain('Alpha Desk');
    // the census is the view-instant count, and the withholding note names the held-back desk (never a silent absence)
    expect(bytes).toContain('2 desks at this view instant');
    expect(bytes).toContain('data-oversight-withheld-desks="true"');
    expect(bytes).toContain('1 desk launched after this view instant');
    expect(bytes).toContain("a desk card never renders before the desk's own launch instant");
  });

  it('the same desk DOES render its full card once the view instant reaches its launch instant (the projection, not a removal)', () => {
    const bytes = bytesAt(stateWithLateDesk(), NOW + 2); // live view at the anchor — past Beta Desk's launch
    expect(bytes).toContain('data-oversight-desk="prj-b"');
    expect(bytes).toContain('Beta Desk');
    expect(bytes).toContain('organization status'); // the launch-derived fields render from the launch instant on
    expect(bytes).toContain('3 desks at this view instant');
    expect(bytes).not.toContain('data-oversight-withheld-desks'); // nothing is held back once the view reaches the launch
  });

  it('the fold-level law: oversightRowsOf excludes the not-yet-launched desk and desksLaunchedAfterViewOf counts it (the pure fold under the render)', () => {
    const state = stateWithLateDesk();
    const before = oversightRowsOf(state, LATE_LAUNCH - 60_000);
    expect(before.map((row) => row.projectId)).toEqual(['prj-a', DEMO_PROJECT_ID]); // the directory's own order, launched desks only
    expect(desksLaunchedAfterViewOf(state.projectDirectory, LATE_LAUNCH - 60_000)).toBe(1);
    const at = oversightRowsOf(state, LATE_LAUNCH);
    expect(at.map((row) => row.projectId)).toEqual(['prj-a', 'prj-b', DEMO_PROJECT_ID]); // launched AT the view instant — exists at it
    expect(desksLaunchedAfterViewOf(state.projectDirectory, LATE_LAUNCH)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FW-42-B (the Round J copy-lag — 6/6 pure testers): the Oversight PANEL's
// copy under a signed-in principal says "your desks" (the account scope the
// pure test proved — the desks follow the account across browsers); the
// anonymous session keeps the exact session-scoped bytes. Same law on the
// scope note, the single-desk teaching note, and the honest empty state.
// ---------------------------------------------------------------------------

describe('FW-42-B (the copy-lag): the Oversight panel copy is account-scoped under a signed-in principal', () => {
  const signedIn = { account: authenticatedAccountPanel('desk.owner') } as Partial<ShellView>;

  it('the scope note reads "your desks" under a principal — the session-scoped undersell is gone', () => {
    const bytes = oversightBytes(oversightState(), signedIn);
    expect(bytes).toContain('One governed view of your desks in workspace tenant-a');
    expect(bytes).toContain('every desk that follows your account, whatever browser launched it');
    expect(bytes).not.toContain("this session's own desks");
  });

  it('the single-desk teaching note names the account-following desks under a principal', () => {
    const single = reduceAll(openWorkspace({ tenantId: 'tenant-a', projectId: DEMO_PROJECT_ID }, T0), [
      { kind: 'projects-listed', at: T0 + 1, records: [project(DEMO_PROJECT_ID, 'the TradRL demo project', 'tenant-available')] },
    ]);
    const bytes = oversightBytes(single, signedIn);
    expect(bytes).toContain('data-oversight-single="true"');
    expect(bytes).toContain('this view consolidates every desk that follows your account');
    expect(bytes).not.toContain('every desk this session owns');
  });

  it('the honest empty state names "your desks" under a principal', () => {
    const empty = reduceAll(openWorkspace({ tenantId: 'tenant-a', projectId: 'prj-a' }, VIEW_AT), [
      { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
    ]);
    const bytes = oversightBytes(empty, signedIn);
    expect(bytes).toContain('No desks readable yet.');
    expect(bytes).toContain('your desks appear here the moment the directory read answers');
    expect(bytes).not.toContain('the desks this session owns appear here');
  });

  it('the anonymous panel keeps the byte-identical session-scoped copy (the signed-out honesty pin)', () => {
    const multi = oversightBytes(oversightState());
    expect(multi).toContain("One governed view of this session's own desks");
    expect(multi).not.toContain('every desk that follows your account');
    const single = reduceAll(openWorkspace({ tenantId: 'tenant-a', projectId: DEMO_PROJECT_ID }, T0), [
      { kind: 'projects-listed', at: T0 + 1, records: [project(DEMO_PROJECT_ID, 'the TradRL demo project', 'tenant-available')] },
    ]);
    const singleBytes = oversightBytes(single);
    expect(singleBytes).toContain('this view consolidates every desk this session owns'); // the single-desk note's own posture is unchanged
    expect(singleBytes).not.toContain('every desk that follows your account');
  });
});

// ---------------------------------------------------------------------------
// FW-43-A (Round K register §3.2 — the product list's #2, M1 + L1's #1
// YES-gate item, DOM-verified absent three rounds running): THE OVERSIGHT
// COCKPIT — the cross-desk aggregate row (the headline), the per-desk
// net-exposure + simulated-P&L columns, and the drill-through from the
// cards (the per-desk Open affordance + the breach count) to the desk's
// own working surfaces. "A census, not yet a PM cockpit" — now a cockpit.
// ---------------------------------------------------------------------------

describe('FW-43-A: the cross-desk aggregate row (the headline)', () => {
  /** Every desk bundled (prj-a 2 fills + 1 refusal + 1 decision + 1 pre-view breach; prj-b 1 fill; the demo desk an honest empty book) — the KNOWN roll-up. */
  function allBundledState(): WorkspaceState {
    return reduceAll(oversightState(), [
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: 'prj-b', utilization: utilizationOf('prj-b'), submissions: [routedFill('xgs:b-1', VIEW_AT - 1500, '10')], decisions: [], readAt: VIEW_AT } },
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: DEMO_PROJECT_ID, utilization: utilizationOf(DEMO_PROJECT_ID), submissions: [], decisions: [], readAt: VIEW_AT } },
    ]);
  }

  it('renders ABOVE the desk cards: the roll-up of the same numbers the cards carry, SIMULATED-tagged, with the honest-sum law disclosed', () => {
    const bytes = oversightBytes(allBundledState());
    expect(bytes).toContain('data-oversight-aggregate="true"');
    // ABOVE the cards: the aggregate renders before the first desk card in the serialized bytes
    expect(bytes.indexOf('data-oversight-aggregate="true"')).toBeLessThan(bytes.indexOf('data-oversight-desk="prj-a"'));
    expect(bytes).toContain('The cross-desk roll-up');
    // the numbers: desks 3, net exposure 110.00 (100.00 + 10 + 0 — the exact-decimal sum of the view-instant books),
    // open positions 2, fills 2 (the post-view fill never enters — L4), decisions 1, breaches 3 (one view-instant breach per desk's read)
    const aggregate = bytes.slice(bytes.indexOf('data-oversight-aggregate="true"'), bytes.indexOf('data-oversight-desk="prj-a"'));
    expect(aggregate).toContain('desks');
    expect(aggregate).toContain('>3<');
    expect(aggregate).toContain('net exposure (standing book notional, all desks)');
    expect(aggregate).toContain('110.00');
    expect(aggregate).toContain('open positions');
    expect(aggregate).toContain('>2<');
    expect(aggregate).toContain('fills on record');
    expect(aggregate).toContain('>2<');
    expect(aggregate).toContain('refusals (gateway-stopped)');
    expect(aggregate).toContain('decisions on record');
    expect(aggregate).toContain('>1<');
    expect(aggregate).toContain('active breaches (view instant)');
    expect(aggregate).toContain('>3<');
    // the disclosure: the same projection the cards ride, exact sums, never fabricated
    expect(aggregate).toContain('never a fabricated sum');
    expect(aggregate).toContain('the same per-desk numbers the cards below carry');
    // the SIMULATED tag rides the aggregate row too (the E-8 row-disclosure law — a copied roll-up never reads as production)
    expect(aggregate).toContain('data-simulated-tag="true"');
  });

  it('a field reads UNKNOWN when any desk\'s field is unknown — never a fabricated sum (the demo desk without a read makes the blotter fields unknown)', () => {
    // the default fixture: prj-a confirmed, prj-b's bundle the ALL-EMPTY
    // unconfirmed shape, the demo desk NEVER read. FW-44-A (L-1) pin
    // update, justified: the unconfirmed bundle now counts as no read on
    // record, so the unknown cause names BOTH desks (pre-fix it named
    // only the demo desk and prj-b's zeros folded into the sums).
    const bytes = oversightBytes(oversightState());
    const aggregate = bytes.slice(bytes.indexOf('data-oversight-aggregate="true"'), bytes.indexOf('data-oversight-desk="prj-a"'));
    expect(aggregate).toContain('>3<'); // the census itself is known
    expect(aggregate).toContain('unknown — 2 desks without a read on record');
    expect(aggregate).toContain('never a fabricated sum');
  });

  it('the aggregate is honest on the live console too: the roll-up renders WITHOUT the SIMULATED tag (the mirror law)', () => {
    const live = oversightBytes(allBundledState(), { simulated: false });
    const aggregate = live.slice(live.indexOf('data-oversight-aggregate="true"'), live.indexOf('data-oversight-desk="prj-a"'));
    expect(aggregate.includes('data-simulated-tag')).toBe(false);
  });
});

describe('FW-43-A: the per-desk net-exposure + simulated P&L columns', () => {
  it('each card carries the net exposure (the gross booked notional of the open positions — the fill-derived book\'s composition) + the SIMULATED book value, honestly labeled NOT a market P&L', () => {
    const bytes = oversightBytes(oversightState());
    const alphaCard = bytes.slice(bytes.indexOf('data-oversight-desk="prj-a"'), bytes.indexOf('data-oversight-desk="prj-b"'));
    // net exposure: 100.00 (the one pre-view fill; the post-view one never enters — L4) across 1 open position
    expect(alphaCard).toContain('net exposure (gross booked notional)');
    expect(alphaCard).toContain('100.00 across 1 open position');
    expect(alphaCard).toContain('the same data the standing rows ride');
    // the simulated P&L basis: the booked notional + fees to date, honestly labeled
    expect(alphaCard).toContain('simulated P&amp;L basis (booked notional + fees to date)');
    expect(alphaCard).toContain('booked notional 100.00 · fees 0.10');
    expect(alphaCard).toContain('NOT a market P&amp;L');
    expect(alphaCard).toContain('no mark-to-market exists on the records this console holds');
    expect(alphaCard).toContain('refusals 0 stopped'); // the honest derived figures named (the refusal count beside the money)
  });

  it('a desk without a read renders unknown for the exposure, the P&L basis and every count — never a fabricated 0', () => {
    const bytes = oversightBytes(oversightState());
    const demoCard = bytes.slice(bytes.indexOf('data-oversight-desk="prj-demo-console"'));
    expect(demoCard).toContain('net exposure (gross booked notional)');
    expect(demoCard).toContain('unknown — no read on record for this desk yet');
    expect(demoCard).toContain('simulated P&amp;L basis (booked notional + fees to date)');
    expect(demoCard).toContain('unknown — no read on record for this desk yet');
    expect(demoCard).toContain('fills on record (view instant)');
    expect(demoCard).toContain('unknown — no read on record for this desk yet');
  });

  it('a bundled desk without a standing read keeps its KNOWN blotter numbers but renders the breach count unknown (per-field honesty)', () => {
    // FW-44-A (L-1) pin update, justified: the pre-fix fixture rode prj-b's
    // ALL-EMPTY bundle and called its zeros "the host's own answer" — the
    // exact unconfirmed shape S1's window proved can be a degraded read
    // (the fold now renders it unknown; pinned in the FW-44-A describe
    // below). The per-field honesty this test exists for needs a CONFIRMED
    // blotter without a standing read — prj-b re-read with one fill.
    const confirmedBlotter = reduceAll(oversightState(), [
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: 'prj-b', utilization: null, submissions: [routedFill('xgs:b-1', VIEW_AT - 1500, '10')], decisions: [], readAt: VIEW_AT } },
    ]);
    const bytes = oversightBytes(confirmedBlotter);
    const betaCard = bytes.slice(bytes.indexOf('data-oversight-desk="prj-b"'), bytes.indexOf('data-oversight-desk="prj-demo-console"'));
    // the blotter answered — its numbers are known (never an invented unknown)
    expect(betaCard).toContain('net exposure (gross booked notional)');
    expect(betaCard).toContain('10 across 1 open position');
    // the standing read never answered — the breach count is UNKNOWN, never 0
    expect(betaCard).toContain('active breaches (view instant)');
    expect(betaCard).toContain('unknown — no standing read on record');
  });
});

describe('FW-43-A: the drill-through affordances (the cards become interactive — keyboard focusable)', () => {
  it('each card carries a real BUTTON "Open this desk" that drills to the desk\'s Execution blotter (data-oversight-open + the execution landing)', () => {
    const bytes = oversightBytes(oversightState());
    const alphaCard = bytes.slice(bytes.indexOf('data-oversight-desk="prj-a"'), bytes.indexOf('data-oversight-desk="prj-b"'));
    expect(alphaCard).toContain('<button class="tm-button');
    expect(alphaCard).toContain('data-action="oversight-open-desk"');
    expect(alphaCard).toContain('data-oversight-open="prj-a"');
    expect(alphaCard).toContain('data-oversight-section="execution"');
    expect(alphaCard).toContain('Open this desk');
    expect(alphaCard).toContain('aria-label="Open Alpha Desk'); // the a11y law: the affordance names its desk
  });

  it('the breach count is the drill-through target for breaches: an ACTIVE count is a button landing on the desk\'s Risk section', () => {
    // prj-a carries one pre-view breach + one post-view breach (the fixture) — the view-instant count is 1, an ACTIVE count
    const bytes = oversightBytes(oversightState());
    const alphaCard = bytes.slice(bytes.indexOf('data-oversight-desk="prj-a"'), bytes.indexOf('data-oversight-desk="prj-b"'));
    expect(alphaCard).toContain('data-action="oversight-open-desk"');
    expect(alphaCard).toContain('data-oversight-section="risk"');
    expect(alphaCard).toContain('1 active — open Risk');
    // the zero-count desk renders the plain number (nothing to drill into — never a dead affordance)
    const cleanRead = reduceAll(oversightState(), [
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: DEMO_PROJECT_ID, utilization: { ...utilizationOf(DEMO_PROJECT_ID), activeBreaches: [] }, submissions: [], decisions: [], readAt: VIEW_AT } },
    ]);
    const clean = oversightBytes(cleanRead);
    const demoCard = clean.slice(clean.indexOf('data-oversight-desk="prj-demo-console"'));
    expect(demoCard).toContain('active breaches (view instant)');
    expect(demoCard).toContain('>0<'); // the honest known zero
    expect(demoCard.includes('data-oversight-section="risk"')).toBe(false); // a 0 count never wears the drill
  });
});

// ---------------------------------------------------------------------------
// FW-44-A (Round L register L-1 — S1's find): the READ-ABSENCE CARD. The
// register's exact rendering: during the window 3 desks' cards read "fills
// 0", "net 0", "org not compiled" — literal zeros contradicting the durable
// compile record and the desks' own live blotters — while the roll-up summed
// them as knowns (understated, no unknown marker on the money fields). The
// card and the roll-up must render unknown-not-on-file vs confirmed-empty
// DISTINCTLY: an unconfirmed read (the present-but-empty bundle) renders the
// honest unknown on every money/count field, and the org pill never claims
// "not compiled" for a desk the durable record itself shows compiled.
// ---------------------------------------------------------------------------

describe('FW-44-A (Round L register L-1): the read-absence card — an unconfirmed read renders unknown, never zeros', () => {
  it('THE S1 CARD: a present-but-empty bundle renders the honest unknown on every money/count field and the standing note — never "fills 0 / net 0"', () => {
    // the default fixture's prj-b IS the S1 shape: a bundle on record with
    // nothing confirmed (no standing read, no submissions, no decisions,
    // no org snapshot — every route answered nothing in the window).
    const bytes = oversightBytes(oversightState());
    const betaCard = bytes.slice(bytes.indexOf('data-oversight-desk="prj-b"'), bytes.indexOf('data-oversight-desk="prj-demo-console"'));
    expect(betaCard).toContain('net exposure (gross booked notional)');
    expect(betaCard).toContain('unknown — no read on record for this desk yet');
    expect(betaCard).toContain('simulated P&amp;L basis (booked notional + fees to date)');
    expect(betaCard).toContain('unknown — no read on record for this desk yet');
    expect(betaCard).toContain('fills on record (view instant)');
    expect(betaCard).toContain('unknown — no read on record for this desk yet');
    expect(betaCard).toContain('standing rows');
    expect(betaCard).toContain('no read on record for this desk yet'); // never "none declared in this desk's standing read" — the read did not answer, so nothing is claimed
    expect(betaCard).not.toContain('0 across 0 open position');        // the literal zero, dead on this card
  });

  it('a CONFIRMED empty read keeps its zeros — "0 across 0 open position" renders when the standing read answered (the card renders unknown-not-on-file vs confirmed-empty distinctly)', () => {
    // the same desk, its standing read answered this time: the empty
    // blotter is the host's own positive claim, and the card says so.
    const confirmed = reduceAll(oversightState(), [
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: 'prj-b', utilization: utilizationOf('prj-b'), submissions: [], decisions: [], readAt: VIEW_AT } },
    ]);
    const bytes = oversightBytes(confirmed);
    const betaCard = bytes.slice(bytes.indexOf('data-oversight-desk="prj-b"'), bytes.indexOf('data-oversight-desk="prj-demo-console"'));
    expect(betaCard).toContain('0 across 0 open position');
    expect(betaCard).not.toContain('unknown — no read on record for this desk yet');
  });

  it('the org pill never claims "not compiled" for a desk the durable record shows COMPILED (organizationRef on record, no status snapshot): the honest "org status unknown"', () => {
    // the register's third literal: "org not compiled" on desks the
    // durable compile record itself shows compiled. The pill's claim is
    // a positive one — only the record may make it: organizationRef
    // null = not compiled (the record's own fact); organizationRef set
    // with no snapshot = compiled, status unknown (never "not compiled").
    const compiledNoSnapshot = { ...project('prj-a', 'Alpha Desk', 'session-owned'), lifecycle: { projectId: 'prj-a', status: 'active' as const, acceptanceCriteriaId: null, organizationRef: 'org:a' } };
    const state = reduceAll(oversightState(), [
      { kind: 'projects-listed', at: VIEW_AT, records: [
        compiledNoSnapshot,
        project('prj-b', 'Beta Desk', 'session-owned'),
        project(DEMO_PROJECT_ID, 'the TradRL demo project', 'tenant-available'),
      ] },
      { kind: 'oversight-read', at: VIEW_AT, read: { projectId: 'prj-a', utilization: utilizationOf('prj-a'), submissions: [routedFill('xgs:a-1', VIEW_AT - 1000)], decisions: [], readAt: VIEW_AT } },
    ]);
    const bytes = oversightBytes(state);
    const alphaCard = bytes.slice(bytes.indexOf('data-oversight-desk="prj-a"'), bytes.indexOf('data-oversight-desk="prj-b"'));
    expect(alphaCard).toContain('<span class="pill-label">org status unknown</span>');
    expect(alphaCard).not.toContain('<span class="pill-label">org not compiled</span>');
    expect(alphaCard).toContain('compiled on the durable record'); // the honest named cause, as its own fact row
    // the not-compiled pill stays EXACTLY what it was for a desk with no organization on record (the record's own fact)
    const betaCard = bytes.slice(bytes.indexOf('data-oversight-desk="prj-b"'), bytes.indexOf('data-oversight-desk="prj-demo-console"'));
    expect(betaCard).toContain('<span class="pill-label">org not compiled</span>');
  });

  it('the roll-up names the unconfirmed desks as the unknown cause on every money field — never the understated known sum (the register\'s fabricated-sum class, dead at the render)', () => {
    const bytes = oversightBytes(oversightState());
    const aggregate = bytes.slice(bytes.indexOf('data-oversight-aggregate="true"'), bytes.indexOf('data-oversight-desk="prj-a"'));
    // prj-b's unconfirmed bundle + the demo desk's absent bundle = TWO desks
    // without a (confirmed) read on record — named, never summed over.
    expect(aggregate).toContain('unknown — 2 desks without a read on record');
    expect(aggregate).toContain('never a fabricated sum');
  });
});

// ---------------------------------------------------------------------------
// FW-47-B (Round M register M-5 — the org-pill leak): the pill rides the
// FOLDED org status (core/oversight.ts's own-instant projection), so a
// scrub inside the window between the project record and its org-snapshot
// record renders the register's third literal 'org status unknown', never
// the leaked 'active' — and the unknown fact row names WHICH unknown it
// holds (the pre-existing no-snapshot sentence vs the new L4 withheld
// sentence naming the snapshot's OWN instant).
// ---------------------------------------------------------------------------

describe('FW-47-B (M-5): the org pill + the unknown fact row at the pre-snapshot window', () => {
  /** The M-5 shape's desk: a COMPILED project (the pill's unknown arm) with an org-status snapshot on the bundle. */
  const compiledAlpha = (snapshotAt: number | null): ReturnType<typeof reduceAll> => {
    const lifecycle = { projectId: 'prj-a', status: 'active' as const, acceptanceCriteriaId: null, organizationRef: 'org:a' };
    return reduceAll(oversightState(), [
      { kind: 'projects-listed', at: VIEW_AT, records: [
        { ...project('prj-a', 'Alpha Desk', 'session-owned'), lifecycle },
        project('prj-b', 'Beta Desk', 'session-owned'),
        project(DEMO_PROJECT_ID, 'the TradRL demo project', 'tenant-available'),
      ] },
      ...(snapshotAt === null
        ? [{ kind: 'oversight-read' as const, at: VIEW_AT, read: { projectId: 'prj-a', utilization: utilizationOf('prj-a'), submissions: [], decisions: [], readAt: VIEW_AT } }]
        : [{ kind: 'oversight-read' as const, at: VIEW_AT, read: { projectId: 'prj-a', utilization: utilizationOf('prj-a'), submissions: [], decisions: [], readAt: VIEW_AT, orgStatus: { organizationRef: 'org:a', tenant: 'tenant-a', project: 'prj-a', status: 'active' as const, at: snapshotAt, instanceRefs: ['ai:director-1'] } } }]),
    ]);
  };

  it('THE PILL INSIDE THE PRE-SNAPSHOT WINDOW: a compiled desk whose snapshot is observed AFTER the view instant renders the register\'s third literal "org status unknown" — NEVER the leaked "active" (L3\'s export-verified shape, dead at the render)', () => {
    // the window: the project record predates the view (it is in the listing), the
    // org-snapshot record lands VIEW_AT+400 — the scrub at VIEW_AT sits between them.
    const bytes = oversightBytes(compiledAlpha(VIEW_AT + 400));
    const alphaCard = bytes.slice(bytes.indexOf('data-oversight-desk="prj-a"'), bytes.indexOf('data-oversight-desk="prj-b"'));
    expect(alphaCard).toContain('<span class="pill-label">org status unknown</span>'); // the register's third literal
    expect(alphaCard).not.toContain('<span class="pill-label">active</span>');         // never the leaked positive
    expect(alphaCard).not.toContain('organization status active');                     // the fact row never leaks it either
    // the WITHHELD sentence names the snapshot's OWN instant (the gate observation's withheldAtView law)
    expect(alphaCard).toContain('withheld — a status snapshot is on record but observed at');
    expect(alphaCard).toContain(`after this view instant (L4; never rendered before its observed instant)`);
    expect(alphaCard).toContain(formatInstantUtc(VIEW_AT + 400));                      // the snapshot's own instant, named
  });

  it('THE TWO UNKNOWN CAUSES STAY DISTINCT at the fact row: no snapshot on record keeps the pre-existing sentence; a withheld snapshot names its own instant; a view at-or-after the snapshot\'s own instant serves it verbatim', () => {
    // cause 1 (the pre-existing unknown): a COMPILED desk with no snapshot on file.
    const noSnapshotBytes = oversightBytes(compiledAlpha(null));
    const noSnapshotCard = noSnapshotBytes.slice(noSnapshotBytes.indexOf('data-oversight-desk="prj-a"'), noSnapshotBytes.indexOf('data-oversight-desk="prj-b"'));
    expect(noSnapshotCard).toContain('<span class="pill-label">org status unknown</span>');
    expect(noSnapshotCard).toContain("unknown — this desk's organization is compiled on the durable record, but no status snapshot is on file (the status read has not answered)"); // the pre-existing sentence, unchanged
    expect(noSnapshotCard).not.toContain('withheld — a status snapshot is on record');                                                               // never the withheld sentence without a snapshot
    // cause 2 (the M-5 window's unknown): the withheld sentence names the snapshot's OWN instant — never the no-snapshot sentence.
    const withheldBytes = oversightBytes(compiledAlpha(VIEW_AT + 400));
    const withheldCard = withheldBytes.slice(withheldBytes.indexOf('data-oversight-desk="prj-a"'), withheldBytes.indexOf('data-oversight-desk="prj-b"'));
    expect(withheldCard).toContain('withheld — a status snapshot is on record but observed at');
    expect(withheldCard).not.toContain('no status snapshot is on file'); // the two causes are never conflated
    // the same desk at a view AT-OR-AFTER the snapshot's own instant serves it verbatim (the boundary at the render)
    const state = compiledAlpha(VIEW_AT + 400);
    const served = reduceAll(state, [{ kind: 'view-timestamp', at: VIEW_AT + 500, timestamp: VIEW_AT + 500 }]);
    const servedBytes = oversightBytes(served);
    const servedCard = servedBytes.slice(servedBytes.indexOf('data-oversight-desk="prj-a"'), servedBytes.indexOf('data-oversight-desk="prj-b"'));
    expect(servedCard).toContain('<span class="pill-label">active</span>');            // verbatim, the boundary's own instant
    expect(servedCard).toContain('organization status');                               // the fact row serves the status
    expect(servedCard).not.toContain('withheld — a status snapshot is on record');
  });
});
