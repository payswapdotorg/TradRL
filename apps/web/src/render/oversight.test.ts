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

const routedFill = (id: string, at: number): GatewaySubmissionRecord => ({
  kind: 'routed', submissionId: id, decisionId: `xd:${id}`, auditId: `xga:${id}`, requestRef: `gor:${id}`,
  venue: 'binance', adapterRef: 'adapter', channelRef: 'channel', routedAt: at,
  fill: { state: 'filled', quantity: '1', price: '100', notional: '100.00', fee: '0.10', filledAt: at },
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

  it('the per-desk card renders the budget rows + utilization (bound + honest current) in the card language (card-title + factRows)', () => {
    const bytes = oversightBytes(oversightState());
    expect(bytes).toContain('outcome.capital.budget (bound)');
    expect(bytes).toContain('10,000'); // the bound, grouped
    expect(bytes).toContain('outcome.capital.budget (standing)');
    expect(bytes).toContain('4,860 · ok'); // the honest current + the read's own verdict
    expect(bytes).toContain('outcome.risk.budget (standing)');
    expect(bytes).toContain('unknown — no defensible number on file'); // never a fabricated zero
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
