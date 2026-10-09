// deploy/vercel/runtime/deliverable.test.ts — THE RESEARCH DELIVERABLE
// COMPOSITION PINS (FW-36-A, Round E register E-1 — the #1 Round E
// blocker, 9/9 personas).
//
// THE LAW PINNED HERE (the work order's own words): the release-candidate
// deliverable's summary is COMPOSED from the project's ACTUAL data, per
// project — the mandate's declared actuals (markets, capital/risk budgets,
// EVERY declared constraint with id + domain + subject + kind + bound, the
// horizon), the world state the launch actually served, the honest lineage
// statement, and the SIMULATED disclosure. NO fixed sentence may remain as
// the summary; TWO DIFFERENT LAUNCHES WITH DIFFERENT MANDATES must produce
// OBSERVABLY DIFFERENT deliverable text — and the pre-FW-36-A stub's own
// shape (kind/specId/version/project) is preserved verbatim (additive-only,
// the promotion route's releaseCandidateOf reads them).
//
// THE HONESTY LAW (the wave's core): every number rendered is a VERBATIM
// citation of a record the input carries — the composer fabricates nothing
// (a fabricated "63% hit rate" would be a WORSE defect than the stub). The
// degraded states are pinned too: a missing record degrades to its honest
// statement ("no goal statement on record", the no-launch-world sentence
// NAMING THE PROJECT), never a placeholder number and never THE ONE FIXED
// SENTENCE every project rendered before FW-36-A.

import { describe, expect, it } from 'vitest';
import { validConstraintSet, validCreateProjectRequest, validGoal } from '../../../services/api/src/fixtures';
import type { ConstraintSetStatement, GoalStatement, TimestampMs } from '../../../services/api/src/index';
import {
  composeResearchDeliverableResult,
  declaredConstraintFacts,
  type DeliverableMandate,
} from './deliverable';
import {
  DEMO_PROJECT_ID,
  demoDeliverableSourceOf,
  durableDeliverableSourceOf,
  horizonSpanLabel,
  launchWorldOfSpec,
  seedDemoBacking,
  withDerivedHorizonLabel,
  type DurableEvidenceSource,
  type LaunchWorldRecord,
} from './demo';

// ---------------------------------------------------------------------------
// Two maximally different mandates (the divergence witnesses)
// ---------------------------------------------------------------------------

const TENANT = 'tenant-deliverable';
const AT = 1_700_000_000_000;

/** M3-style: the maximally NUMBERS-DENSE goal the Round E register quotes (2418 round trips, 63% hit rate, 8bps). */
function numbersDenseGoal(): GoalStatement {
  return {
    ...(validGoal(TENANT) as unknown as GoalStatement),
    objective: '2418 round trips at a 63% hit rate inside an 8bps cost budget, z-scores above 2, half-life under 4 hours',
    horizon: { startsAt: AT as TimestampMs, endsAt: (AT + 30 * 86_400_000) as TimestampMs, label: 'the dense mandate window' },
  };
}

function numbersDenseConstraintSet(): ConstraintSetStatement {
  return {
    ...(validConstraintSet(TENANT) as unknown as ConstraintSetStatement),
    id: 'cs-dense',
    constraints: [
      { id: 'c-1', domain: 'outcome', subject: 'book.notional', predicate: { kind: 'limit.max', bound: 250000000 }, severity: 'blocking' },
      { id: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', predicate: { kind: 'equals', value: '2400000000.00' }, severity: 'blocking' },
      { id: 'k-risk-budget', domain: 'outcome', subject: 'risk.budget', predicate: { kind: 'equals', value: '50000000.00' }, severity: 'blocking' },
      { id: 'c-2', domain: 'outcome', subject: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.18 }, severity: 'blocking' },
    ],
  } as unknown as ConstraintSetStatement;
}

/** The sparse counter-mandate: one instrument, one declared budget, a different window. */
function sparseGoal(): GoalStatement {
  return {
    ...(validGoal(TENANT) as unknown as GoalStatement),
    objective: 'Hold the single-instrument band; keep it simple.',
    horizon: { startsAt: (AT + 86_400_000) as TimestampMs, endsAt: (AT + 10 * 86_400_000) as TimestampMs, label: 'the quiet window' },
  };
}

function sparseConstraintSet(): ConstraintSetStatement {
  return {
    ...(validConstraintSet(TENANT) as unknown as ConstraintSetStatement),
    id: 'cs-sparse',
    constraints: [
      { id: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', predicate: { kind: 'equals', value: '10000.00' }, severity: 'blocking' },
    ],
  } as unknown as ConstraintSetStatement;
}

const DENSE_WORLD: LaunchWorldRecord = {
  markets: ['BTC-USD', 'ETH-USD'],
  venues: ['binance', 'kraken'],
  dataSources: ['candle-v1', 'depth-v1'],
  executionMode: 'simulation',
  capitalBudget: '2400000000.00',
  riskBudget: '50000000.00',
  horizon: { startsAt: AT, endsAt: AT + 30 * 86_400_000, label: 'the dense mandate window' },
};

const SPARSE_WORLD: LaunchWorldRecord = {
  markets: ['SOL-USD'],
  venues: ['okx'],
  dataSources: ['trades-v1'],
  executionMode: 'simulation',
  capitalBudget: '10000.00',
  riskBudget: '250.00',
  horizon: { startsAt: AT + 86_400_000, endsAt: AT + 10 * 86_400_000, label: 'the quiet window' },
};

const DENSE_MANDATE: DeliverableMandate = { goal: numbersDenseGoal(), constraintSet: numbersDenseConstraintSet(), world: DENSE_WORLD };
const SPARSE_MANDATE: DeliverableMandate = { goal: sparseGoal(), constraintSet: sparseConstraintSet(), world: SPARSE_WORLD };

// ---------------------------------------------------------------------------
// The composer's law
// ---------------------------------------------------------------------------

describe('deploy/vercel — the research deliverable composition (FW-36-A, Round E register E-1)', () => {
  it('TWO DIFFERENT MANDATES produce OBSERVABLY DIFFERENT deliverable text — every declared actual of each mandate appears verbatim in its own summary (the E-1 mandate pin)', () => {
    const dense = composeResearchDeliverableResult({
      project: 'prj-dense-launch',
      director: 'spec-launch-director',
      mandate: DENSE_MANDATE,
      observed: { markets: DENSE_WORLD.markets, venues: DENSE_WORLD.venues },
      promotion: null,
    });
    const sparse = composeResearchDeliverableResult({
      project: 'prj-sparse-launch',
      director: 'spec-launch-director',
      mandate: SPARSE_MANDATE,
      observed: { markets: SPARSE_WORLD.markets, venues: SPARSE_WORLD.venues },
      promotion: null,
    });
    const denseSummary = dense.summary as string;
    const sparseSummary = sparse.summary as string;
    expect(denseSummary).not.toBe(sparseSummary); // NEVER the one fixed sentence again
    // The DENSE mandate's own actuals, verbatim-traceable: its markets/venues,
    // its declared budgets, EVERY declared constraint (id + subject + kind +
    // bound), its horizon bounds + label, its constraint count.
    expect(denseSummary).toContain('BTC-USD');
    expect(denseSummary).toContain('ETH-USD');
    expect(denseSummary).toContain('binance');
    expect(denseSummary).toContain('2400000000.00'); // its declared capital budget
    expect(denseSummary).toContain('50000000.00'); // its declared risk budget
    expect(denseSummary).toContain('c-1 (outcome, book.notional, limit.max, bound 250000000)');
    expect(denseSummary).toContain('c-2 (outcome, risk.maxDrawdown, limit.max, bound 0.18)');
    expect(denseSummary).toContain('4 declared constraints');
    expect(denseSummary).toContain(new Date(AT).toISOString());
    expect(denseSummary).toContain(new Date(AT + 30 * 86_400_000).toISOString());
    // FW-37-A (F-4 — 8/9 personas): the horizon label is the SPAN-DERIVED
    // one ('30 days' for this 30-day mandate), computed from the bounds —
    // never the goal record's own free-text annotation ('the dense mandate
    // window'), which the pre-wave composer trusted off the wire (the
    // production defect: a stale 'one day' default rendered on 30/45/60/90-
    // day horizons while the dates stayed correct).
    expect(denseSummary).toContain('(span 30 days)');
    expect(denseSummary).not.toContain('the dense mandate window');
    expect(dense.horizon).toEqual({ startsAt: AT, endsAt: AT + 30 * 86_400_000, label: '30 days' }); // the structured field carries the same derived label — text and field can never disagree
    // The SPARSE mandate's own actuals — and each summary carries ONLY its own.
    expect(sparseSummary).toContain('SOL-USD');
    expect(sparseSummary).toContain('okx');
    expect(sparseSummary).toContain('10000.00');
    expect(sparseSummary).toContain('1 declared constraint');
    // FW-37-A (F-4): the sparse mandate's 9-day span (AT+1d -> AT+10d)
    // renders its own derived label.
    expect(sparseSummary).toContain('(span 9 days)');
    expect(sparseSummary).not.toContain('the quiet window');
    expect(sparseSummary).not.toContain('BTC-USD');
    expect(denseSummary).not.toContain('SOL-USD');
    // The objective rides verbatim (the mandate's own words, never paraphrased).
    expect(dense.objective).toBe('2418 round trips at a 63% hit rate inside an 8bps cost budget, z-scores above 2, half-life under 4 hours');
    expect(sparse.objective).toBe('Hold the single-instrument band; keep it simple.');
  });

  it('the stub\'s own shape is PRESERVED verbatim (additive-only: kind/specId/version/project — the promotion route reads them) + the structured additive fields', () => {
    const payload = composeResearchDeliverableResult({
      project: 'prj-dense-launch',
      director: 'spec-launch-director',
      mandate: DENSE_MANDATE,
      observed: { markets: DENSE_WORLD.markets, venues: DENSE_WORLD.venues },
      promotion: null,
    });
    expect(payload.kind).toBe('release-candidate');
    expect(payload.specId).toBe('spec-launch-director');
    expect(payload.version).toBe(1);
    expect(payload.project).toBe('prj-dense-launch');
    // The structured additive fields (traceable rows, never prose-only).
    expect(payload.markets).toEqual(['BTC-USD', 'ETH-USD']);
    expect(payload.venues).toEqual(['binance', 'kraken']);
    expect(payload.capitalBudget).toBe('2400000000.00');
    expect(payload.riskBudget).toBe('50000000.00');
    const constraints = payload.constraints as readonly { readonly id: string; readonly domain: string; readonly subject: string; readonly kind: string; readonly bound: string }[];
    expect(constraints).toHaveLength(4);
    expect(constraints.find((row) => row.id === 'c-1')).toEqual({ id: 'c-1', domain: 'outcome', subject: 'book.notional', kind: 'limit.max', bound: '250000000' });
    expect(constraints.find((row) => row.id === 'k-capital-budget')?.bound).toBe('2400000000.00'); // the equals value, verbatim
    // And the mandate reader itself: a malformed row is skipped, never a crash (R46).
    expect(declaredConstraintFacts({ ...sparseConstraintSet(), constraints: [null, 'not-a-constraint', sparseConstraintSet().constraints[0]] as never })).toHaveLength(1);
  });

  it('THE HONEST LINEAGE statement: the pending truth at composition time, the promoted outcome id when one exists — never a fabricated citation', () => {
    const pending = composeResearchDeliverableResult({ project: 'prj-a', director: 'spec-launch-director', mandate: DENSE_MANDATE, observed: null, promotion: null });
    const lineage = pending.lineage as { promotedDecision: string | null; statement: string };
    expect(lineage.promotedDecision).toBeNull(); // nothing cites this deliverable yet — the honest truth
    expect(lineage.statement).toContain('pending promotion');
    const promoted = composeResearchDeliverableResult({ project: 'prj-a', director: 'spec-launch-director', mandate: DENSE_MANDATE, observed: null, promotion: { outcomeId: 'out:9f1c2e3d' } });
    const promotedLineage = promoted.lineage as { promotedDecision: string | null; statement: string };
    expect(promotedLineage.promotedDecision).toBe('out:9f1c2e3d');
    expect(promotedLineage.statement).toContain('out:9f1c2e3d');
    expect(promoted.summary as string).toContain('out:9f1c2e3d');
  });

  it('THE SIMULATED DISCLOSURE is preserved (it is a simulated research deliverable — the badge language stays)', () => {
    const payload = composeResearchDeliverableResult({ project: 'prj-a', director: 'spec-demo-director', mandate: DENSE_MANDATE, observed: { markets: DENSE_WORLD.markets, venues: DENSE_WORLD.venues }, promotion: null });
    const disclosure = payload.disclosure as string;
    expect(disclosure).toContain('SIMULATED');
    expect(disclosure).toContain('never a fabricated research statistic');
    expect(payload.summary as string).toContain('SIMULATED');
  });

  it('THE DEGRADED STATES degrade to their HONEST statements (THE HONESTY LAW: never a placeholder number, never the one fixed sentence)', () => {
    // Nothing on record AT ALL: the honest statements, naming the project.
    const bare = composeResearchDeliverableResult({ project: 'prj-nowhere', director: 'spec-launch-director', mandate: null, observed: null, promotion: null });
    expect(bare.summary as string).toContain('no launch world on record for prj-nowhere');
    expect(bare.summary as string).toContain('no goal on record');
    expect(bare.summary as string).toContain('no declared constraints on record');
    expect(bare.objective).toBe('no goal statement on record for this project at this host');
    // Two DIFFERENT bare projects still render DIFFERENT text (they name
    // themselves — the pre-fix stub rendered the IDENTICAL bytes for all).
    const otherBare = composeResearchDeliverableResult({ project: 'prj-elsewhere', director: 'spec-launch-director', mandate: null, observed: null, promotion: null });
    expect(bare.summary).not.toBe(otherBare.summary);
    // A mandate with NO budget declarations cites "not declared" — never a number.
    const noBudgets = composeResearchDeliverableResult({
      project: 'prj-nobudgets',
      director: 'spec-launch-director',
      mandate: { goal: sparseGoal(), constraintSet: { ...sparseConstraintSet(), constraints: [{ id: 'k-position', domain: 'state', subject: 'position.grossExposure', predicate: { kind: 'limit.max', bound: 2 }, severity: 'blocking' }] } as ConstraintSetStatement, world: null },
      observed: null,
      promotion: null,
    });
    expect(noBudgets.capitalBudget).toBe('not declared');
    expect(noBudgets.riskBudget).toBe('not declared');
    expect(noBudgets.summary as string).toContain('not declared');
    expect(noBudgets.summary as string).toContain('no launch world on record for prj-nobudgets');
  });
});

// ---------------------------------------------------------------------------
// The two backings' deliverable sources (the composition's capture readers)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the deliverable sources over each backing\'s own captures (FW-36-A E-1)', () => {
  it('the DEMO arm: the W-25B goal-set capture + the W-28 world capture + the promotion registry, keyed on the credential tenant; the DEMO project\'s observed state is its own SEEDED blotter', () => {
    const ports = seedDemoBacking(TENANT);
    const created = ports.controlPlane.createProject({
      ...validCreateProjectRequest(TENANT, 'prj-deliverable-a'),
      tenantId: TENANT, // the pipeline-injected scope (the capture keys on it — L12)
      goal: numbersDenseGoal(),
      constraintSet: numbersDenseConstraintSet(),
    } as Parameters<typeof ports.controlPlane.createProject>[0]);
    expect(created.ok).toBe(true); // the capture rides the real create route
    (ports.jobSubmission.worlds as unknown as Map<string, LaunchWorldRecord>).set(`${TENANT}/prj-deliverable-a`, DENSE_WORLD);
    const promotions = {
      decisionOfJob: (tenant: string, jobId: string) => (tenant === TENANT && jobId === 'job-1' ? { outcomeId: 'out:promoted-1' } : null),
    };
    const source = demoDeliverableSourceOf(TENANT, ports, promotions);
    // The launched project: its captured mandate + observed world, verbatim.
    const mandate = source.mandateOf('prj-deliverable-a');
    expect(mandate?.goal.objective).toContain('2418 round trips');
    expect(mandate?.constraintSet.id).toBe('cs-dense');
    expect(mandate?.world?.markets).toEqual(['BTC-USD', 'ETH-USD']);
    const observed = source.observedOf('prj-deliverable-a');
    expect(observed?.markets).toEqual(['BTC-USD', 'ETH-USD']);
    expect(observed?.venues).toEqual(['binance', 'kraken']);
    // The promotion reader (the composition-time lineage).
    expect(source.promotionOf('job-1')).toEqual({ outcomeId: 'out:promoted-1' });
    expect(source.promotionOf('job-unknown')).toBeNull();
    // A project with nothing on record composes nothing (never a fabricated mandate).
    expect(source.mandateOf('prj-foreign')).toBeNull();
    expect(source.observedOf('prj-foreign')).toBeNull();
    // The DEMO project's observed state is its own SEEDED blotter (world-less
    // BY DESIGN since W-28 — never a fabricated world record).
    const demoObserved = source.observedOf(DEMO_PROJECT_ID);
    expect(demoObserved?.markets).toContain('BTC-USD');
    expect(demoObserved?.markets).toContain('ETH-USD');
    expect(demoObserved?.venues).toContain('BROKER-FIX');
    // And the composed deliverable over the source's own reads: the mandate
    // pin holds through the SOURCE too (end-to-end within the demo arm).
    const payload = composeResearchDeliverableResult({
      project: 'prj-deliverable-a',
      director: 'spec-launch-director',
      mandate: source.mandateOf('prj-deliverable-a'),
      observed: source.observedOf('prj-deliverable-a'),
      promotion: source.promotionOf('job-1'),
    });
    expect(payload.objective).toContain('2418 round trips'); // the mandate's own words ride the deliverable verbatim
    expect(payload.summary as string).toContain('2400000000.00');
    expect((payload.lineage as { promotedDecision: string | null }).promotedDecision).toBe('out:promoted-1');
  });

  it('the DURABLE arm: the seam\'s hydrated goal sets feed the same law; a degraded/absent read composes nothing (R46)', () => {
    const durableSource: DurableEvidenceSource = {
      goalSetOf: (project) => (project === 'prj-durable-deliv' ? { goal: sparseGoal(), constraintSet: sparseConstraintSet(), world: SPARSE_WORLD } : null),
      organizationRefOf: () => 'org:compiled-prj-durable-deliv',
    };
    const source = durableDeliverableSourceOf(TENANT, durableSource, null);
    const mandate = source.mandateOf('prj-durable-deliv');
    expect(mandate?.constraintSet.id).toBe('cs-sparse');
    expect(mandate?.world?.markets).toEqual(['SOL-USD']);
    expect(source.observedOf('prj-durable-deliv')?.venues).toEqual(['okx']);
    expect(source.mandateOf('prj-nothing')).toBeNull(); // a degraded/absent read — never a fabricated mandate
    expect(source.promotionOf('job-any')).toBeNull(); // no registry bound — the honest pending lineage
    // The DEMO project's observed state stays the seeded blotter under durable too.
    expect(source.observedOf(DEMO_PROJECT_ID)?.markets).toContain('BTC-USD');
  });
});

// ---------------------------------------------------------------------------
// FW-37-A (Round F register F-4 — the round's most frequent defect, 8/9
// personas): the horizon label is COMPUTED from the record's own bounds —
// never a free-text annotation trusted off the wire (the launch draft's
// stale 'one day' default rendered on 30/45/60/90-day horizons while the
// DATES stayed correct; S1's 90-day review showed "2160h 00m 00s" next to
// its "(one day)" deliverable). Pinned: the label computation itself, the
// capture seam (launchWorldOfSpec), the serve-side healing of pre-wave
// persisted worlds, and the deliverable text across the horizons.
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-37-A (F-4): the horizon label is the span-derived one, everywhere it renders', () => {
  /** The wizard's stale default annotation, exactly as the launch draft stamps it. */
  const STALE_LABEL = 'one day';

  it('WHOLE-DAY SPANS: 1/30/45/60/90 days (the 1-day case was the only correct pre-fix rendering — it stays byte-identical)', () => {
    expect(horizonSpanLabel(AT, AT + 86_400_000)).toBe('one day');
    expect(horizonSpanLabel(AT, AT + 30 * 86_400_000)).toBe('30 days');
    expect(horizonSpanLabel(AT, AT + 45 * 86_400_000)).toBe('45 days');
    expect(horizonSpanLabel(AT, AT + 60 * 86_400_000)).toBe('60 days');
    expect(horizonSpanLabel(AT, AT + 90 * 86_400_000)).toBe('90 days');
  });

  it('SUB-DAY SPANS render the wizard review\'s own precise form (the review S1 read: "2160h 00m 00s" for the 90-day span)', () => {
    expect(horizonSpanLabel(AT, AT + 90 * 86_400_000 + 3_600_000)).toBe('2161h 00m 00s'); // 90 days + 1h — not a whole-day span
    expect(horizonSpanLabel(AT, AT + 25 * 3_600_000)).toBe('25h 00m 00s');
    expect(horizonSpanLabel(AT, AT + 3_600_000 + 61_000)).toBe('1h 01m 01s');
  });

  it('DEGENERATE SPANS answer the honest labels (never a fabricated duration)', () => {
    expect(horizonSpanLabel(AT, AT)).toBe('an empty span');
    expect(horizonSpanLabel(AT, AT - 86_400_000)).toBe('an empty span');
    expect(horizonSpanLabel(Number.NaN, AT + 86_400_000)).toBe('an unverifiable span');
  });

  it('THE CAPTURE SEAM derives the label from the bounds — the console\'s stale \'one day\' annotation on a 90-day horizon never crosses (S1\'s case)', () => {
    const world = launchWorldOfSpec({
      kind: 'console-launch',
      markets: ['BTC-USD'],
      venues: ['BROKER-FIX'],
      dataSources: ['candle-v1'],
      executionMode: 'simulation',
      capitalBudget: '250000',
      riskBudget: '12500',
      horizon: { startsAt: AT, endsAt: AT + 90 * 86_400_000, label: STALE_LABEL },
    });
    expect(world).not.toBeNull();
    expect(world?.horizon.startsAt).toBe(AT); // the bounds ride verbatim
    expect(world?.horizon.endsAt).toBe(AT + 90 * 86_400_000);
    expect(world?.horizon.label).toBe('90 days'); // the label is COMPUTED from them — the annotation is not trusted off the wire
    // A spec with no label at all captures the same derived one.
    const unlabeled = launchWorldOfSpec({
      kind: 'console-launch',
      markets: ['BTC-USD'],
      venues: ['BROKER-FIX'],
      dataSources: ['candle-v1'],
      executionMode: 'simulation',
      capitalBudget: '250000',
      riskBudget: '12500',
      horizon: { startsAt: AT, endsAt: AT + 45 * 86_400_000 },
    });
    expect(unlabeled?.horizon.label).toBe('45 days');
  });

  it('THE SERVE-SIDE HEALING: a pre-wave persisted world (the stale annotation aboard) serves the span-derived label — one law, every record', () => {
    const preWaveWorld: LaunchWorldRecord = {
      markets: ['BTC-USD'],
      venues: ['BROKER-FIX'],
      dataSources: ['candle-v1'],
      executionMode: 'simulation',
      capitalBudget: '250000',
      riskBudget: '12500',
      horizon: { startsAt: AT, endsAt: AT + 60 * 86_400_000, label: STALE_LABEL },
    };
    const healed = withDerivedHorizonLabel(preWaveWorld);
    expect(healed.horizon.label).toBe('60 days');
    expect(healed.horizon.startsAt).toBe(AT);
    expect(healed.horizon.endsAt).toBe(AT + 60 * 86_400_000);
    expect(healed.markets).toEqual(preWaveWorld.markets); // the rest of the record is untouched
    // A malformed horizon answers the record unchanged (R46 — never a crash).
    const malformed = { ...preWaveWorld, horizon: { startsAt: AT } as LaunchWorldRecord['horizon'] };
    expect(withDerivedHorizonLabel(malformed)).toBe(malformed);
  });

  it('THE DELIVERABLE renders the span-derived label across the horizons — the summary text and the structured horizon field agree, and the stale annotation never renders', () => {
    for (const [days, label] of [[1, 'one day'], [30, '30 days'], [45, '45 days'], [60, '60 days'], [90, '90 days']] as const) {
      // The goal statement carries the launch draft's stale annotation, exactly as production launched it.
      const goal = { ...numbersDenseGoal(), horizon: { startsAt: AT as TimestampMs, endsAt: (AT + days * 86_400_000) as TimestampMs, label: STALE_LABEL } };
      const payload = composeResearchDeliverableResult({
        project: 'prj-f4-horizon',
        director: 'spec-launch-director',
        mandate: { goal, constraintSet: numbersDenseConstraintSet(), world: DENSE_WORLD },
        observed: null,
        promotion: null,
      });
      const summary = payload.summary as string;
      expect(summary).toContain(`(span ${label})`); // the derived label, computed from the bounds
      expect(summary).toContain(new Date(AT).toISOString()); // the dates were always correct — they stay
      expect(summary).toContain(new Date(AT + days * 86_400_000).toISOString());
      expect(summary).not.toContain('(one day)'); // the stale annotation never renders as the horizon's label
      expect(payload.horizon).toEqual({ startsAt: AT, endsAt: AT + days * 86_400_000, label }); // the structured field carries the SAME derived label
    }
  });
});
