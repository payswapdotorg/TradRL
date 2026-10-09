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

/** An INDEPENDENT exact-decimal add (6-digit fixed-point — the reconciliation witness for the projected-book arithmetic). */
function independentAdd(a: string, b: string): string {
  const parse = (value: string): bigint => {
    const negative = value.startsWith('-');
    const [intPart, fracPart = ''] = value.replace('-', '').split('.');
    const digits = BigInt(`${intPart}${fracPart}`) * 10n ** BigInt(6 - fracPart.length);
    return negative ? -digits : digits;
  };
  return String(Number(parse(a) + parse(b)) / 1_000_000);
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

  it('THE HONEST PRE-TRADE-RISK REFUSAL quotes the project\'s OWN declared bound with TRUE projected-book arithmetic that reconciles by inspection (FW-36-A, the numeric refusal law)', () => {
    const seed = deriveProjectEvidence(envelope());
    if (seed === null) return;
    const refusal = seed.submissions.find((row) => row.kind === 'refused');
    expect(refusal).toBeDefined();
    if (refusal === undefined || refusal.kind !== 'refused') return;
    expect(refusal.refusal.stage).toBe('risk_limits');
    const quoted = (refusal.refusal as { readonly refusals: readonly { readonly constraintId: string; readonly domain: string; readonly subject: string; readonly severity: string; readonly predicate: { readonly kind: string; readonly value?: string; readonly bound?: number }; readonly observed: string }[] }).refusals[0];
    // FW-36-A (E-2): the refusal derives from the user's OWN declared
    // constraint — the mandate's capital-budget declaration (equals
    // 10000.00) — with the TRUE projected book: the prior cumulative fills
    // + the candidate's OWN notional. The pre-fix behavior (a drawdown
    // ceiling quoted with observed = bound x 1.2 — reconciling to neither
    // the order line nor the book) is gone.
    expect(quoted.constraintId).toBe('k-capital-budget');
    expect(quoted.domain).toBe('outcome');
    expect(quoted.subject).toBe('capital.budget');
    expect(quoted.severity).toBe('blocking');
    expect(quoted.predicate.kind).toBe('equals');
    expect(quoted.predicate.value).toBe('10000.00');
    // The arithmetic RECONCILES BY INSPECTION (exact decimals throughout):
    // the refused row's own order line (8.333333 x 1200 = 9999.9996) + the
    // prior cumulative book of the two fills (6 + 1.5 = 7.5) = observed.
    expect(quoted.observed).toBe('10007.4996');
    expect(independentMultiply(refusal.order?.quantity ?? '0', refusal.order?.price ?? '0')).toBe('9999.9996'); // the candidate's OWN notional — the order line
    const entry = seed.submissions[0];
    const trim = seed.submissions[1];
    expect(independentAdd(independentMultiply(entry?.order?.quantity ?? '0', entry?.order?.price ?? '0'), independentMultiply(trim?.order?.quantity ?? '0', trim?.order?.price ?? '0'))).toBe('7.5'); // the prior cumulative book
    expect(independentAdd('7.5', '9999.9996')).toBe(quoted.observed); // prior + candidate = projected, exactly
    // The deciding body of a refusal is the NAMED risk gate — never "unknown".
    expect(refusal.decisionBody).toBe(PROJECT_RISK_GATE);
    expect(refusal.decisionRationale).toContain('10000');
    expect(refusal.decisionRationale).toContain('10007.4996');
    expect(refusal.decisionRationale).toContain('9999.9996');
    // E-2.1/E-2.2: the row carries the gate's own evaluation of EVERY
    // declared constraint at this candidate — the c-1 drawdown ceiling
    // honestly NOT gate-evaluable from a projected book (realized-class
    // subject), the budget constraint BREACHED with the itemized arithmetic.
    const evaluation = (refusal.limitsEvaluation ?? []).find((row) => row.constraintId === 'k-capital-budget');
    expect(evaluation?.verdict).toBe('breach');
    expect(evaluation?.basis).toBe('projected_book_notional');
    expect(evaluation?.observed).toBe('10007.4996');
    expect(evaluation?.arithmetic).toContain('10007.4996');
    const drawdownEvaluation = (refusal.limitsEvaluation ?? []).find((row) => row.constraintId === 'c-1');
    expect(drawdownEvaluation?.verdict).toBe('pass'); // the chain's realized consumption 0.0015 vs the declared 0.2 — computed, not asserted
    expect(drawdownEvaluation?.basis).toBe('realized_cumulative');
    const positionEvaluation = (refusal.limitsEvaluation ?? []).find((row) => row.subject === 'position.grossExposure');
    expect(positionEvaluation).toBeUndefined(); // the fixture declares no position subject — nothing fabricated
    // The ENTRY's limits stamp is COMPUTED from the same declared constraints (never a fixed stamp).
    const entryLimitsCheck = (entry?.riskChecks ?? []).find((check) => check.dimension === 'limits');
    expect(entryLimitsCheck?.outcome).toBe('pass');
    const entryBudgetEvaluation = (entry?.limitsEvaluation ?? []).find((row) => row.constraintId === 'k-capital-budget');
    expect(entryBudgetEvaluation?.verdict).toBe('pass'); // projected book 6 inside the declared 10000 — computed
    expect(entryBudgetEvaluation?.observed).toBe('6');
    const entryDrawdownEvaluation = (entry?.limitsEvaluation ?? []).find((row) => row.constraintId === 'c-1');
    expect(entryDrawdownEvaluation?.verdict).toBe('not_gate_evaluable'); // L4: the chain provides nothing yet AT the entry — never silently passed
    expect(entryDrawdownEvaluation?.note).toContain('not gate-evaluable');
  });

  it('the refusal bound\'s honesty order: a DECLARED limit.max over a gate-observable subject first, else the mandate\'s declared budget, else the launch world\'s own declared capital budget (FW-36-A — every branch a user-declared record)', () => {
    // BRANCH 1 — the user's own book.notional limit.max outranks the budget
    // declaration: the tightest gate-observable max bound is quoted.
    const declaredEnvelope = envelope({
      constraintSet: {
        ...launchedConstraintSet(),
        constraints: [
          ...launchedConstraintSet().constraints,
          { id: 'c-9', domain: 'outcome', subject: 'book.notional', predicate: { kind: 'limit.max', bound: 8000 }, severity: 'blocking', description: 'the book cap' },
        ],
      } as ConstraintSetStatement,
    });
    const declaredSeed = deriveProjectEvidence(declaredEnvelope);
    expect(declaredSeed).not.toBeNull();
    const declaredRefusal = declaredSeed?.submissions.find((row) => row.kind === 'refused');
    const declaredQuoted = declaredRefusal !== undefined && declaredRefusal.kind === 'refused'
      ? (declaredRefusal.refusal as { readonly refusals: readonly { readonly constraintId: string; readonly subject: string; readonly predicate: { readonly kind: string; readonly bound: number }; readonly observed: string }[] }).refusals[0]
      : undefined;
    expect(declaredQuoted?.constraintId).toBe('c-9'); // the user's OWN limit.max — the whole point of E-2
    expect(declaredQuoted?.subject).toBe('book.notional');
    expect(declaredQuoted?.predicate.kind).toBe('limit.max');
    expect(declaredQuoted?.predicate.bound).toBe(8000);
    expect(declaredQuoted?.observed).toBe('8007.4992'); // prior 7.5 + the order line 6.666666 x 1200 = 7999.9992, exact

    // BRANCH 3 — no budget/book bound anywhere in the constraint set (only a
    // position cap, which is honestly NOT gate-evaluable at fill time): the
    // launch world's OWN declared capital budget is the cited bound (a real
    // user-declared record — never an invented constraint).
    const worldBudgetEnvelope = envelope({
      constraintSet: {
        ...launchedConstraintSet(),
        constraints: [
          { id: 'k-position', domain: 'state', subject: 'position.grossExposure', predicate: { kind: 'limit.max', bound: 2 }, severity: 'blocking' },
        ],
      } as ConstraintSetStatement,
    });
    const worldBudgetSeed = deriveProjectEvidence(worldBudgetEnvelope);
    expect(worldBudgetSeed).not.toBeNull();
    const worldBudgetRefusal = worldBudgetSeed?.submissions.find((row) => row.kind === 'refused');
    const worldBudgetQuoted = worldBudgetRefusal !== undefined && worldBudgetRefusal.kind === 'refused'
      ? (worldBudgetRefusal.refusal as { readonly refusals: readonly { readonly constraintId: string; readonly subject: string; readonly predicate: { readonly kind: string; readonly bound: number }; readonly observed: string }[] }).refusals[0]
      : undefined;
    expect(worldBudgetQuoted?.constraintId).toBe('cs-prj-evidence-1:capital-budget');
    expect(worldBudgetQuoted?.subject).toBe('capital.budget');
    expect(worldBudgetQuoted?.predicate.kind).toBe('limit.max');
    expect(worldBudgetQuoted?.predicate.bound).toBe(10000);
    expect(worldBudgetQuoted?.observed).toBe('10007.4996'); // the same TRUE projected book — the world's declared capital budget cited
    // And the k-position subject is honestly NOT gate-evaluable at fill time
    // (no position store exists on any backing) — reported with the loud
    // teaching note, never silently passed (E-2.4).
    const positionEvaluations = (worldBudgetRefusal?.limitsEvaluation ?? []).filter((row) => row.constraintId === 'k-position');
    expect(positionEvaluations).toHaveLength(1);
    expect(positionEvaluations[0]?.verdict).toBe('not_gate_evaluable');
    expect(positionEvaluations[0]?.note).toContain('EXECUTION/TRADE/RISK SCOPING IS NOT YET DECLARABLE');
    expect(positionEvaluations[0]?.note).toContain('observation | state | action | outcome');
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
