// deploy/vercel/runtime/project-evidence.test.ts — the per-project
// evidence seed generator's own law (FW-MI-B, MI-D2 + MI-D10).
//
// Pure, offline, deterministic — the generator's contract, pinned:
//   - the DERIVED STREAM is the demo project's own shape (3 blotter
//     rows — 2 routed fills + 1 honest pre-trade-risk refusal — plus an
//     adverse-gap outcome and its confidence-rated post-mortem), scaled
//     to the project's OWN envelope numbers;
//   - the NOTIONAL MATH reconciles exactly from the printed qty x price
//     (an independent exact-decimal reimplementation recomputes it);
//   - the REFUSAL quotes bound vs observed from the project's OWN
//     declared limits (its constraint set's limit.max first, else its
//     goal's limit.max criterion, else its declared risk budget);
//   - the NAMED deciding bodies derive from the project's own identity
//     (never "unknown" — MI-D10);
//   - the SEVEN named pre-trade risk checks ride every routed row;
//   - the rationale PROSE cites the project's actual goal numbers
//     (capital budget, risk budget, declared drawdown ceiling);
//   - the HONESTY DISCIPLINE: the simulated attribution is stated in
//     the prose and the records (declaredBy names the launch director;
//     the post-mortem's hypothesis note says simulated);
//   - DETERMINISM: identical envelope -> byte-identical records;
//   - the GATES: a malformed or zero-budget envelope answers null
//     (nothing fabricated — the honest pre-fix emptiness).
//
// Spec anchors: L8/L12/L20, R45, UX-DESIGN §7; wave1-report MI-D2/MI-D10.

import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  isGatewaySubmissionRecord,
  isOutcomeRecordMirror,
  isPostMortemRecordMirror,
  type ConstraintSetStatement,
  type GoalStatement,
} from '../../../services/api/src/index';
import { deriveProjectEvidence, PROJECT_LAUNCH_DIRECTOR, PROJECT_RISK_GATE, type ProjectBlotterRow, type ProjectEvidenceEnvelope } from './project-evidence';
import type { LaunchWorldRecord } from './demo';

// ---------------------------------------------------------------------------
// The envelope fixtures (a launched project's own captured records —
// the same shape apps/web toCreateProjectInput + toLaunchJobSpec send)
// ---------------------------------------------------------------------------

const TENANT = 'tenant-demo';
const PROJECT = 'prj-evidence-1';
const LAUNCH_AT = 1_700_000_000_000;

function launchedGoal(): GoalStatement {
  return {
    id: `goal-${PROJECT}`,
    version: 1,
    tenantId: TENANT,
    objective: 'Find and keep an edge in momentum.',
    horizon: { startsAt: LAUNCH_AT, endsAt: LAUNCH_AT + 90 * 24 * 3_600_000, label: 'the launch window' },
    successCriteria: {
      criteria: [
        { id: 'sc-1', metric: 'pnl.net', predicate: { kind: 'limit.min', bound: 0 }, description: 'net profit is non-negative' },
        { id: 'sc-2', metric: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 }, description: 'bounded drawdown' },
      ],
      requiredSatisfaction: 0.5,
    },
    evaluation: { blindRef: 'eval:blind-1', walkForwardRef: 'eval:wf-1', regimeRef: 'eval:regime-1', adversarialRequired: true },
    createdAt: LAUNCH_AT,
  } as unknown as GoalStatement;
}

function launchedConstraintSet(): ConstraintSetStatement {
  return {
    id: `cs-${PROJECT}`,
    version: 1,
    tenantId: TENANT,
    constraints: [
      { id: 'c-1', domain: 'outcome', subject: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 }, severity: 'blocking', description: 'the drawdown ceiling' },
      { id: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', predicate: { kind: 'equals', value: '10000.00' }, severity: 'blocking' },
      { id: 'k-risk-budget', domain: 'outcome', subject: 'risk.budget', predicate: { kind: 'equals', value: '250.00' }, severity: 'blocking' },
    ],
    createdAt: LAUNCH_AT,
  } as unknown as ConstraintSetStatement;
}

function launchedWorld(overrides: Partial<LaunchWorldRecord> = {}): LaunchWorldRecord {
  return {
    markets: ['BTC-USD', 'ETH-USD'],
    venues: ['binance', 'kraken'],
    dataSources: ['candle-v1', 'depth-v1'],
    executionMode: 'simulation',
    capitalBudget: '10000.00',
    riskBudget: '250.00',
    horizon: { startsAt: LAUNCH_AT, endsAt: LAUNCH_AT + 86_400_000, label: 'one day' },
    ...overrides,
  };
}

function envelope(overrides: Partial<ProjectEvidenceEnvelope> = {}): ProjectEvidenceEnvelope {
  return {
    tenant: TENANT,
    project: PROJECT,
    goal: launchedGoal(),
    constraintSet: launchedConstraintSet(),
    world: launchedWorld(),
    organizationRef: `org:compiled-${PROJECT}`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// An INDEPENDENT exact-decimal multiply (the reconciliation witness —
// reimplemented here, never imported from the module under test)
// ---------------------------------------------------------------------------

function independentMultiply(a: string, b: string): string {
  const parse = (value: string): { readonly digits: bigint; readonly scale: number } => {
    const [intPart, fracPart = ''] = value.replace('-', '').split('.');
    return { digits: BigInt(`${intPart}${fracPart}`), scale: fracPart.length };
  };
  const left = parse(a);
  const right = parse(b);
  let digits = left.digits * right.digits;
  let scale = left.scale + right.scale;
  while (scale > 0 && digits % 10n === 0n) {
    digits /= 10n;
    scale -= 1;
  }
  const plain = digits.toString();
  const body = scale === 0 ? plain : `${plain.padStart(scale + 1, '0').slice(0, -scale)}.${plain.padStart(scale + 1, '0').slice(-scale)}`;
  return (a.startsWith('-') !== b.startsWith('-')) && digits !== 0n ? `-${body}` : body;
}

function independentSubtract(a: string, b: string): string {
  const parse = (value: string): bigint => {
    const negative = value.startsWith('-');
    const [intPart, fracPart = ''] = value.replace('-', '').split('.');
    const digits = BigInt(`${intPart}${fracPart}`) * 10n ** BigInt(6 - fracPart.length);
    return negative ? -digits : digits;
  };
  return String(Number(parse(a) - parse(b)) / 1_000_000);
}

const CANONICAL = /^-?(0|[1-9]\d*)(?:\.\d+)?$/;

/** The ROUTED variant of a derived blotter row (the union's routed leg — venue/routedAt live there). */
function routedOf(row: ProjectBlotterRow | undefined): Extract<ProjectBlotterRow, { readonly kind: 'routed' }> | undefined {
  return row !== undefined && row.kind === 'routed' ? row : undefined;
}

// ---------------------------------------------------------------------------
// The generator's law
// ---------------------------------------------------------------------------

describe('deploy/vercel — the per-project evidence seed (MI-D2/MI-D10: the launched desk\'s own stream, in the demo project\'s shape)', () => {
  it('derives the full stream: 3 blotter rows (2 routed fills + 1 honest refusal) + an adverse-gap outcome + its confidence-rated post-mortem', () => {
    const seed = deriveProjectEvidence(envelope());
    expect(seed).not.toBeNull();
    if (seed === null) return;
    expect(seed.submissions).toHaveLength(3);
    const routed = seed.submissions.filter((row) => row.kind === 'routed');
    const refused = seed.submissions.filter((row) => row.kind === 'refused');
    expect(routed).toHaveLength(2);
    expect(refused).toHaveLength(1);
    expect(routed.every((row) => row.fill !== undefined && row.fill.state === 'filled')).toBe(true);
    expect(seed.outcome.outcomeClass).toBe('adverse_gap');
    expect(seed.postMortem.subject.outcomeRecordRef).toBe(seed.outcome.outcomeId); // attached to ITS outcome (the D-2 convention)
  });

  it('every derived record satisfies the boundary\'s own structural guards (the frozen route table would serve them verbatim)', () => {
    const seed = deriveProjectEvidence(envelope());
    if (seed === null) return;
    expect(seed.submissions.every((row) => isGatewaySubmissionRecord(row))).toBe(true);
    expect(isOutcomeRecordMirror(seed.outcome)).toBe(true);
    expect(isPostMortemRecordMirror(seed.postMortem)).toBe(true);
  });

  it('THE NOTIONAL MATH RECONCILES EXACTLY from the printed qty x price — every printed number a canonical exact decimal (never a float)', () => {
    const seed = deriveProjectEvidence(envelope());
    if (seed === null) return;
    for (const row of seed.submissions) {
      if (row.kind !== 'routed' || row.order === undefined || row.fill === undefined) continue;
      expect(row.fill.notional).toBe(independentMultiply(row.order.quantity, row.order.price)); // qty x price === notional, exactly
      expect(row.fill.quantity).toBe(row.order.quantity);
      expect(row.fill.price).toBe(row.order.price);
      for (const value of [row.order.quantity, row.order.price, row.fill.notional, row.fill.fee]) {
        expect(value).toMatch(CANONICAL);
      }
    }
    // The concrete numbers for the fixture envelope (capital 10000.00, risk 250.00 — the project's own budgets):
    const entry = seed.submissions[0];
    expect(entry?.order?.quantity).toBe('0.005'); // 250.00 x 0.00002
    expect(entry?.order?.price).toBe('1200'); // 10000.00 x 0.12
    expect(entry?.fill?.notional).toBe('6'); // 0.005 x 1200, exact
    const trim = seed.submissions[1];
    expect(trim?.order?.quantity).toBe('0.0025');
    expect(trim?.order?.price).toBe('600');
    expect(trim?.fill?.notional).toBe('1.5');
  });

  it('THE HONEST PRE-TRADE-RISK REFUSAL quotes bound vs observed from the project\'s OWN constraint set (the numeric refusal law)', () => {
    const seed = deriveProjectEvidence(envelope());
    if (seed === null) return;
    const refusal = seed.submissions.find((row) => row.kind === 'refused');
    expect(refusal).toBeDefined();
    if (refusal === undefined || refusal.kind !== 'refused') return;
    expect(refusal.refusal.stage).toBe('risk_limits');
    const quoted = (refusal.refusal as { readonly refusals: readonly { readonly constraintId: string; readonly domain: string; readonly subject: string; readonly severity: string; readonly predicate: { readonly kind: string; readonly bound: number }; readonly observed: string }[] }).refusals[0];
    // The project's OWN c-1 drawdown ceiling, quoted verbatim + the observed derived exactly (0.2 x 1.2).
    expect(quoted.constraintId).toBe('c-1');
    expect(quoted.subject).toBe('risk.maxDrawdown');
    expect(quoted.severity).toBe('blocking');
    expect(quoted.predicate.kind).toBe('limit.max');
    expect(quoted.predicate.bound).toBe(0.2);
    expect(quoted.observed).toBe('0.24');
    expect(quoted.observed).toBe(independentMultiply(String(quoted.predicate.bound), '1.2'));
    // The deciding body of a refusal is the NAMED risk gate — never "unknown".
    expect(refusal.decisionBody).toBe(PROJECT_RISK_GATE);
    expect(refusal.decisionRationale).toContain('0.2');
    expect(refusal.decisionRationale).toContain('0.24');
  });

  it('the refusal falls back to the project\'s OWN goal criterion when the constraint set declares no numeric limit, and to its declared risk budget when neither does', () => {
    // No limit.max constraints -> the goal's own sc-2 drawdown ceiling.
    const criterionEnvelope = envelope({
      constraintSet: {
        ...launchedConstraintSet(),
        constraints: [
          { id: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', predicate: { kind: 'equals', value: '10000.00' }, severity: 'blocking' },
          { id: 'k-risk-budget', domain: 'outcome', subject: 'risk.budget', predicate: { kind: 'equals', value: '250.00' }, severity: 'blocking' },
        ],
      } as ConstraintSetStatement,
    });
    const criterionSeed = deriveProjectEvidence(criterionEnvelope);
    expect(criterionSeed).not.toBeNull();
    const criterionRefusal = criterionSeed?.submissions.find((row) => row.kind === 'refused');
    const criterionQuoted = criterionRefusal !== undefined && criterionRefusal.kind === 'refused'
      ? (criterionRefusal.refusal as { readonly refusals: readonly { readonly constraintId: string; readonly subject: string; readonly predicate: { readonly bound: number }; readonly observed: string }[] }).refusals[0]
      : undefined;
    expect(criterionQuoted?.constraintId).toBe('sc-2');
    expect(criterionQuoted?.subject).toBe('risk.maxDrawdown');
    expect(criterionQuoted?.predicate.bound).toBe(0.2);
    expect(criterionQuoted?.observed).toBe('0.24');

    // No limit anywhere -> the declared risk budget (k-risk-budget, equals 250.00): the doubled position's projected consumption.
    const budgetEnvelope = envelope({
      goal: {
        ...launchedGoal(),
        successCriteria: { criteria: [{ id: 'sc-1', metric: 'pnl.net', predicate: { kind: 'limit.min', bound: 0 }, description: 'net profit is non-negative' }], requiredSatisfaction: 1 },
      } as GoalStatement,
      constraintSet: {
        ...launchedConstraintSet(),
        constraints: [
          { id: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', predicate: { kind: 'equals', value: '10000.00' }, severity: 'blocking' },
          { id: 'k-risk-budget', domain: 'outcome', subject: 'risk.budget', predicate: { kind: 'equals', value: '250.00' }, severity: 'blocking' },
        ],
      } as ConstraintSetStatement,
    });
    const budgetSeed = deriveProjectEvidence(budgetEnvelope);
    expect(budgetSeed).not.toBeNull();
    const budgetRefusal = budgetSeed?.submissions.find((row) => row.kind === 'refused');
    const budgetQuoted = budgetRefusal !== undefined && budgetRefusal.kind === 'refused'
      ? (budgetRefusal.refusal as { readonly refusals: readonly { readonly constraintId: string; readonly subject: string; readonly predicate: { readonly bound: number }; readonly observed: string }[] }).refusals[0]
      : undefined;
    expect(budgetQuoted?.constraintId).toBe('k-risk-budget');
    expect(budgetQuoted?.subject).toBe('risk.budget');
    expect(budgetQuoted?.predicate.bound).toBe(250);
    expect(budgetQuoted?.observed).toBe('550'); // 250 x 2.2, exact
  });

  it('NAMED deciding bodies + actors derived from the project\'s own identity (MI-D10: never "unknown"), with the SEVEN named pre-trade checks on every routed row', () => {
    const seed = deriveProjectEvidence(envelope());
    if (seed === null) return;
    for (const row of seed.submissions) {
      expect(typeof row.decisionBody).toBe('string');
      expect(row.decisionBody as string).not.toBe('unknown');
      expect((row.decisionBody as string).length).toBeGreaterThan(0);
    }
    const desk = `desk:${PROJECT}-execution`;
    expect(seed.submissions.filter((row) => row.kind === 'routed').every((row) => row.decisionBody === desk)).toBe(true);
    for (const row of seed.submissions.filter((entry) => entry.kind === 'routed')) {
      expect(row.riskChecks).toHaveLength(7);
      expect(row.riskChecks?.map((check) => check.dimension)).toEqual(['kill_switch', 'identity', 'authorization', 'limits', 'venue_permissions', 'rate_limits', 'credentials']);
      expect(row.riskChecks?.every((check) => check.outcome === 'pass')).toBe(true);
    }
    // The outcome record carries the same named body + checks (the Decisions section's detail card).
    expect(seed.outcome.decisionBody).toBe(desk);
    expect(seed.outcome.riskChecks).toHaveLength(7);
    // The instruments and venue are the project's OWN world, not the demo's.
    expect(seed.submissions[0]?.order?.instrumentId).toBe('BTC-USD');
    expect(seed.submissions[1]?.order?.instrumentId).toBe('ETH-USD');
    expect(seed.submissions[0]?.order?.venueId).toBe('binance');
    expect(routedOf(seed.submissions[0])?.venue).toBe('binance');
  });

  it('the rationale PROSE cites the project\'s ACTUAL goal numbers (capital budget, risk budget, declared drawdown ceiling) — the verbatim-style audit prose', () => {
    const seed = deriveProjectEvidence(envelope());
    if (seed === null) return;
    const entry = seed.submissions[0];
    expect(entry?.decisionRationale).toContain('10000.00'); // its declared capital budget, verbatim
    expect(entry?.decisionRationale).toContain('250.00'); // its declared risk budget, verbatim
    expect(entry?.decisionRationale).toContain('0.2'); // its declared drawdown ceiling
    expect(entry?.decisionRationale).toContain('simulated'); // the simulated attribution, stated
    expect(entry?.decisionRationale).toContain(`org:compiled-${PROJECT}`); // its compiled organization
    expect(seed.outcome.decisionRationale).toContain('10000.00');
    expect(seed.outcome.decisionRationale).toContain('250.00');
  });

  it('the outcome\'s realized-gap story reconciles exactly (expected vs realized vs tolerance vs gap — all canonical decimals, gap = realized - expected)', () => {
    const seed = deriveProjectEvidence(envelope());
    if (seed === null) return;
    const outcome = seed.outcome;
    expect(outcome.expectation.expectedQuantity).toBe('0.005');
    expect(outcome.expectation.expectedRealized).toBe('0.006'); // 6 x 0.001, exact
    expect(outcome.expectation.tolerance).toBe('0.0006'); // 0.006 x 0.1, exact
    expect(outcome.expectation.declaredBy).toBe(PROJECT_LAUNCH_DIRECTOR); // the launch director — the spec-demo-director pattern, per-project
    expect(outcome.realization.realizedOutcome).toBe('-0.0015'); // the adverse quarter of the expectation
    expect(outcome.realization.notionalTotal).toBe('6');
    expect(outcome.deviation.realizedGap).toBe('-0.0075'); // -0.0015 - 0.006, exact
    expect(independentSubtract(outcome.realization.realizedOutcome, outcome.expectation.expectedRealized as string)).toBe('-0.0075');
    expect(outcome.deviation.withinTolerance).toBe(false); // the adverse gap exceeds the tolerance — the post-mortem's subject
    // The post-mortem carries the confidence-rated hypothesis (unit-interval confidence + the simulated attribution).
    const hypothesis = seed.postMortem.hypotheses[0];
    expect(hypothesis?.class).toBe('decision');
    expect(hypothesis?.confidence).toBe('0.8');
    expect(hypothesis?.confidence).toMatch(/^0(\.\d+)?$/);
    expect(hypothesis?.note).toContain('simulated');
    expect(seed.postMortem.subject.outcomeRecordRef).toBe(outcome.outcomeId);
  });

  it('DETERMINISM: identical envelope -> byte-identical records; a different project -> different ids (content-addressed)', () => {
    const first = deriveProjectEvidence(envelope());
    const second = deriveProjectEvidence(envelope());
    expect(canonicalJson(second as never)).toBe(canonicalJson(first as never)); // byte-identical (the digest pins it)
    const otherProject = deriveProjectEvidence(envelope({ project: 'prj-evidence-2', organizationRef: 'org:compiled-prj-evidence-2' }));
    expect(otherProject).not.toBeNull();
    expect(otherProject?.outcome.outcomeId).not.toBe(first?.outcome.outcomeId);
    expect(otherProject?.submissions[0]?.submissionId).not.toBe(first?.submissions[0]?.submissionId);
    // The instants derive from the goal's own createdAt (the launch instant) — point-in-time stable, never a wall clock.
    expect(routedOf(first?.submissions[0])?.routedAt).toBe(LAUNCH_AT + 250);
    expect(first?.outcome.asOf).toBe(LAUNCH_AT + 500);
    expect(first?.postMortem.asOf).toBe(LAUNCH_AT + 1_000);
  });

  it('THE GATES: a malformed or zero-budget envelope answers null — nothing is fabricated (the honest pre-fix emptiness, R46)', () => {
    // A zero-capital desk honestly executes nothing.
    expect(deriveProjectEvidence(envelope({ world: launchedWorld({ capitalBudget: '0' }) }))).toBeNull();
    expect(deriveProjectEvidence(envelope({ world: launchedWorld({ riskBudget: '0.00' }) }))).toBeNull();
    // A malformed budget / world / goal never crosses (never a crash).
    expect(deriveProjectEvidence(envelope({ world: launchedWorld({ capitalBudget: 'not-a-decimal' }) }))).toBeNull();
    expect(deriveProjectEvidence(envelope({ world: launchedWorld({ markets: [] }) }))).toBeNull();
    expect(deriveProjectEvidence(envelope({ world: launchedWorld({ venues: [] }) }))).toBeNull();
    expect(deriveProjectEvidence(envelope({ goal: { ...launchedGoal(), createdAt: Number.NaN } as unknown as GoalStatement }))).toBeNull();
    expect(deriveProjectEvidence(envelope({ organizationRef: '' }))).toBeNull();
  });
});
