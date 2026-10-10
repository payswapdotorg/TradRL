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
import { renderConsoleModel } from './model';
import { defaultShellView, type ShellView } from './shell';
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
    expect(tags.length).toBe(3); // one per desk row
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
    expect(betaCard).toContain('none declared in this desk\'s standing read'); // no utilization in the bundle — the honest absence
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
