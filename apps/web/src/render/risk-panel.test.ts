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

import { describe, expect, it } from 'vitest';
import type { ConstraintSetStatement, GoalStatement, RiskUtilizationRead } from '../api/contracts';
import { openWorkspace, reduceAll, type WorkspaceEvent } from '../core/workspace';
import { renderConsoleModel } from './model';
import { defaultShellView } from './shell';
import { serializeVNode } from './vtree';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
const T0 = 1_700_000_000_000;

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

  it('renders the active-breach aggregation: bound-vs-observed, the audit ref, the instant, the deciding body', () => {
    const bytes = renderBytes(riskState(utilizationRead()));
    expect(bytes).toContain('Active breaches (1)');
    expect(bytes).toContain('xgs:demo0003');
    expect(bytes).toContain('risk-limits refusal');
    expect(bytes).toContain('position.grossExposure');
    expect(bytes).toContain('observed 2.4');
    expect(bytes).toContain('xga:demo0003');
    expect(bytes).toContain('gate:pre-trade-risk');
  });

  it('states the L4 current-instant law on the surface (the read is NOT projected to the view instant) and carries the honesty disclosure', () => {
    const bytes = renderBytes(riskState(utilizationRead()));
    expect(bytes).toContain('Standing read as of 2026-10-08T05:00:00.000Z');
    expect(bytes).toContain('not projected to the view instant');
    expect(bytes).toContain('THE HONESTY LAW');
  });

  it('renders the honest zero-breach state as the absence it is (never a fabricated all-clear)', () => {
    const read = utilizationRead({ activeBreaches: [] });
    const bytes = renderBytes(riskState(read));
    expect(bytes).toContain('Active breaches (0)');
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
