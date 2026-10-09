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
import { deriveProjectEvidence, evaluateConstraintAtGate, gateSubjectClassOf, PROJECT_LAUNCH_DIRECTOR, PROJECT_RISK_GATE, type GateCandidateContext, type GateConstraint, type ProjectBlotterRow, type ProjectEvidenceEnvelope } from './project-evidence';
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
    // position cap — which FW-37-A (F-1) now EVALUATES at every candidate:
    // the pre-wave not_gate_evaluable verdict was the round's #1 finding):
    // the launch world's OWN declared capital budget is the cited bound (a
    // real user-declared record — never an invented constraint), and the
    // position cap breaches at the concentration candidate (2 prior open
    // positions + 1 new = 3 vs the declared 2) — cited alongside (F-8).
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
    // FW-37-A (F-8): the position-cap breach is cited TOO — every breached
    // bound rides the refusal (L1's case: the capital budget AND the
    // position cap breached by the same candidate).
    const worldBudgetCitations = worldBudgetRefusal !== undefined && worldBudgetRefusal.kind === 'refused'
      ? (worldBudgetRefusal.refusal as { readonly refusals: readonly { readonly constraintId: string; readonly subject: string; readonly severity: string; readonly observed: string }[] }).refusals
      : [];
    expect(worldBudgetCitations).toHaveLength(2);
    expect(worldBudgetCitations[1]).toMatchObject({ constraintId: 'k-position', subject: 'position.grossExposure', severity: 'blocking', observed: '3' }); // 2 prior positions + 1 new — the count class's own arithmetic
    // And the k-position subject EVALUATES at the gate on every candidate
    // (F-1): pass at the entry (1 projected position) and the trim (2 — at
    // the declared cap, not over), breach at the concentration (3 > 2) with
    // the count arithmetic itemized — the pre-wave not_gate_evaluable
    // verdict (taught-not-enforced while the UI card overclaimed) is gone.
    const worldBudgetRows = worldBudgetSeed?.submissions ?? [];
    const entryPositionEvaluation = (worldBudgetRows[0]?.limitsEvaluation ?? []).find((row) => row.constraintId === 'k-position');
    expect(entryPositionEvaluation?.verdict).toBe('pass');
    expect(entryPositionEvaluation?.observed).toBe('1'); // 0 prior + this candidate's 1 new position
    expect(entryPositionEvaluation?.basis).toBe('projected_position_count');
    const trimPositionEvaluation = (worldBudgetRows[1]?.limitsEvaluation ?? []).find((row) => row.constraintId === 'k-position');
    expect(trimPositionEvaluation?.verdict).toBe('pass');
    expect(trimPositionEvaluation?.observed).toBe('2'); // 1 prior + 1 — exactly at the declared cap, not over
    const positionEvaluations = (worldBudgetRefusal?.limitsEvaluation ?? []).filter((row) => row.constraintId === 'k-position');
    expect(positionEvaluations).toHaveLength(1);
    expect(positionEvaluations[0]?.verdict).toBe('breach');
    expect(positionEvaluations[0]?.observed).toBe('3'); // 2 prior open positions + this candidate's 1 new position
    expect(positionEvaluations[0]?.arithmetic).toContain('prior open positions 2 + this candidate\'s 1 new position = 3 projected open positions');
    expect(positionEvaluations[0]?.arithmetic).toContain('10007.4996'); // the same book's notional projection itemized alongside (the other class, taught)
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

// ---------------------------------------------------------------------------
// FW-37-A (Round F register F-1 + F-8): the position/concentration/turnover
// classes BIND at the gate — the round's #1 finding (6/9 personas e2=partial;
// L2's cap-1 desk held 2 concurrent positions; M1's fills totaling 9,375
// passed a 500 bound; L3's 600 turnover blew to a 19,200 standing breach).
// The pins assert REAL behavior: a candidate breaching each class is refused
// with itemized reconcilable arithmetic; a candidate inside every bound
// passes with limits stamped from the computed verdict; a genuinely
// not-computable case keeps the honest not_gate_evaluable verdict with the
// severity stamp ALIGNED (never 'blocking' for a class that cannot bind).
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-37-A (F-1): the newly-binding classes evaluate honestly at every candidate (prior + candidate = projected, itemized, exact)', () => {
  /** A gate candidate context with the FW-37-A fields (overridable per case). */
  function gateContext(overrides: Partial<GateCandidateContext> = {}): GateCandidateContext {
    return {
      priorBookNotional: '700',
      candidateNotional: '300',
      realizedCumulative: null,
      declaredCapital: '10000',
      priorPositionCount: 1,
      priorTurnoverNotional: '450',
      ...overrides,
    };
  }

  /** One gate constraint row (the declared record's own fields + its canonical bound text). */
  function gateConstraint(overrides: Partial<GateConstraint> = {}): GateConstraint {
    return {
      constraintId: 'c-2',
      domain: 'state',
      subject: 'position.grossExposure',
      severity: 'blocking',
      predicate: { kind: 'limit.max', bound: 2 },
      boundText: '2',
      ...overrides,
    };
  }

  it('the classifier reads the three classes (position.grossExposure, the bare outcome-scoped position subject, position.concentration, costs.dailyTurnover)', () => {
    expect(gateSubjectClassOf('position.grossExposure')).toBe('position_gross_exposure');
    expect(gateSubjectClassOf('position')).toBe('position_gross_exposure'); // the outcome-scoped form S1/S2/M2/S3 declared
    expect(gateSubjectClassOf('Position.GrossExposure')).toBe('position_gross_exposure'); // case-insensitive, the grammar's own camelCase
    expect(gateSubjectClassOf('position.concentration')).toBe('position_concentration');
    expect(gateSubjectClassOf('costs.dailyTurnover')).toBe('daily_turnover');
    // The pre-existing classes are unchanged.
    expect(gateSubjectClassOf('book.notional')).toBe('book_notional');
    expect(gateSubjectClassOf('capital.budget')).toBe('book_notional');
    expect(gateSubjectClassOf('order.notional')).toBe('order_notional');
    expect(gateSubjectClassOf('risk.budget')).toBe('risk_consumption');
    expect(gateSubjectClassOf('risk.maxDrawdown')).toBe('drawdown');
    expect(gateSubjectClassOf('weather.ice')).toBe('not_gate_evaluable'); // an unknown subject stays honestly not-evaluable
  });

  it('POSITION CAP EXCEEDED BY ONE: prior 2 open positions + this candidate = 3 vs the declared cap 2 — breach, itemized by count with the notional projection taught on the same row', () => {
    const evaluation = evaluateConstraintAtGate(
      gateConstraint({ predicate: { kind: 'limit.max', bound: 2 }, boundText: '2' }),
      gateContext({ priorPositionCount: 2, priorBookNotional: '7500', candidateNotional: '249999.99' }),
    );
    expect(evaluation.verdict).toBe('breach');
    expect(evaluation.basis).toBe('projected_position_count');
    expect(evaluation.observed).toBe('3');
    expect(evaluation.derivable).toBe(true);
    expect(evaluation.severity).toBe('blocking'); // a bound that binds keeps the declared severity
    // The count class's own arithmetic, itemized so it reconciles by inspection.
    expect(evaluation.arithmetic).toContain('prior open positions 2 + this candidate\'s 1 new position = 3 projected open positions');
    // The SAME book's notional projection rides the row (the other class, taught): prior 7500 + candidate 249999.99 = 257499.99.
    expect(evaluation.arithmetic).toContain('prior 7500 + candidate 249999.99 = 257499.99');
    expect(evaluation.note).toContain('the projected 3 open positions stand past the declared limit.max bound 2');
  });

  it('POSITION CAP AT THE CAP, NOT OVER: prior 1 + this candidate = 2 vs the declared cap 2 — pass (the trim of a cap-2 desk routes)', () => {
    const evaluation = evaluateConstraintAtGate(gateConstraint(), gateContext({ priorPositionCount: 1 }));
    expect(evaluation.verdict).toBe('pass');
    expect(evaluation.observed).toBe('2');
    expect(evaluation.arithmetic).toContain('prior open positions 1 + this candidate\'s 1 new position = 2 projected open positions');
  });

  it('CONCENTRATION OVER THE FRACTION: this candidate 300 / the projected total book 1000 (prior 700 + candidate 300) = 0.3 vs the declared 0.25 — breach, itemized (L2\'s declared bound)', () => {
    const evaluation = evaluateConstraintAtGate(
      gateConstraint({ constraintId: 'c-3', subject: 'position.concentration', predicate: { kind: 'limit.max', bound: 0.25 }, boundText: '0.25' }),
      gateContext({ priorBookNotional: '700', candidateNotional: '300' }),
    );
    expect(evaluation.verdict).toBe('breach');
    expect(evaluation.basis).toBe('projected_concentration');
    expect(evaluation.observed).toBe('0.3');
    expect(evaluation.arithmetic).toContain('this candidate\'s own notional 300 / the projected total book 1000 (prior 700 + candidate 300) = the concentration fraction 0.3');
    expect(evaluation.note).toContain('the projected concentration fraction 0.3 stands past the declared limit.max bound 0.25');
  });

  it('CONCENTRATION INSIDE THE FRACTION: candidate 200 / projected book 1000 = 0.2 vs 0.25 — pass', () => {
    const evaluation = evaluateConstraintAtGate(
      gateConstraint({ constraintId: 'c-3', subject: 'position.concentration', predicate: { kind: 'limit.max', bound: 0.25 }, boundText: '0.25' }),
      gateContext({ priorBookNotional: '800', candidateNotional: '200' }),
    );
    expect(evaluation.verdict).toBe('pass');
    expect(evaluation.observed).toBe('0.2');
  });

  it('TURNOVER WINDOW OVER THE BOUND: the day\'s 450 already traded + this candidate\'s 300 = 750 vs the declared 500 — breach, itemized (M1\'s evidence: fills totaling 9,375 past a 500 bound can no longer pass)', () => {
    const evaluation = evaluateConstraintAtGate(
      gateConstraint({ constraintId: 'c-4', domain: 'action', subject: 'costs.dailyTurnover', predicate: { kind: 'limit.max', bound: 500 }, boundText: '500' }),
      gateContext({ priorTurnoverNotional: '450', candidateNotional: '300' }),
    );
    expect(evaluation.verdict).toBe('breach');
    expect(evaluation.basis).toBe('projected_daily_turnover');
    expect(evaluation.observed).toBe('750');
    expect(evaluation.arithmetic).toContain('the trading day\'s (UTC) traded notional already on record 450 + this candidate\'s own notional 300 = the day\'s projected turnover 750');
    expect(evaluation.note).toContain('the trading day\'s projected turnover 750 stands past the declared limit.max bound 500');
  });

  it('TURNOVER INSIDE THE BOUND: the day\'s 450 + this candidate\'s 50 = 500 vs the declared 500 — pass AT the bound (not over)', () => {
    const evaluation = evaluateConstraintAtGate(
      gateConstraint({ constraintId: 'c-4', domain: 'action', subject: 'costs.dailyTurnover', predicate: { kind: 'limit.max', bound: 500 }, boundText: '500' }),
      gateContext({ priorTurnoverNotional: '450', candidateNotional: '50' }),
    );
    expect(evaluation.verdict).toBe('pass');
    expect(evaluation.observed).toBe('500');
  });

  it('THE NOT-COMPUTABLE CASES STAY HONEST: verdict not_gate_evaluable + the severity stamp ALIGNED with the verdict (never blocking for a class that cannot bind)', () => {
    // An unknown subject class — the gate holds no observation for it.
    const unknown = evaluateConstraintAtGate(
      gateConstraint({ constraintId: 'c-x', domain: 'observation', subject: 'weather.ice', predicate: { kind: 'limit.max', bound: 5 }, boundText: '5' }),
      gateContext(),
    );
    expect(unknown.verdict).toBe('not_gate_evaluable');
    expect(unknown.severity).toBe('non-binding'); // the stamp aligned — it never claims an enforcement the gate cannot honor
    expect(unknown.declaredSeverity).toBe('blocking'); // the declaration rides verbatim, traceable
    expect(unknown.note).toContain('not gate-evaluable at fill time');
    expect(unknown.note).toContain('position.grossExposure'); // the teaching names every gate-evaluable class now
    expect(unknown.note).toContain('costs.dailyTurnover');
    // A declaration with no positive numeric bound — a limit without a number is not a limit the gate can compare.
    const noBound = evaluateConstraintAtGate(gateConstraint({ boundText: null, predicate: { kind: 'limit.max' } }), gateContext());
    expect(noBound.verdict).toBe('not_gate_evaluable');
    expect(noBound.severity).toBe('non-binding');
    expect(noBound.declaredSeverity).toBe('blocking');
    // The turnover class without a computable day-scoped sum — honest, never a fabricated window figure.
    const noDaySum = evaluateConstraintAtGate(
      gateConstraint({ constraintId: 'c-4', domain: 'action', subject: 'costs.dailyTurnover', predicate: { kind: 'limit.max', bound: 500 }, boundText: '500' }),
      gateContext({ priorTurnoverNotional: null }),
    );
    expect(noDaySum.verdict).toBe('not_gate_evaluable');
    expect(noDaySum.severity).toBe('non-binding');
    expect(noDaySum.note).toContain('traded-notional sum cannot be computed');
    // The position class without a computable prior count.
    const noCount = evaluateConstraintAtGate(gateConstraint(), gateContext({ priorPositionCount: Number.NaN }));
    expect(noCount.verdict).toBe('not_gate_evaluable');
    expect(noCount.severity).toBe('non-binding');
    // An ADVISORY not-derivable row keeps its declared advisory stamp (advisory never claimed to block).
    const advisoryUnknown = evaluateConstraintAtGate(
      gateConstraint({ constraintId: 'c-x', domain: 'observation', subject: 'weather.ice', severity: 'advisory', predicate: { kind: 'limit.max', bound: 5 }, boundText: '5' }),
      gateContext(),
    );
    expect(advisoryUnknown.severity).toBe('advisory');
    // The realized-cumulative class before the chain provides a record (L4 point-in-time) — the not-YET note, aligned stamp.
    const notYet = evaluateConstraintAtGate(
      gateConstraint({ constraintId: 'c-1', subject: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 }, boundText: '0.2' }),
      gateContext({ realizedCumulative: null, declaredCapital: '10000' }),
    );
    expect(notYet.verdict).toBe('not_gate_evaluable');
    expect(notYet.severity).toBe('non-binding');
    expect(notYet.declaredSeverity).toBe('blocking');
    expect(notYet.note).toContain('becomes gate-evaluable once a realized record exists');
  });
});

describe('deploy/vercel — FW-37-A (F-1 + F-8): the full stream — a desk sized inside every bound passes; a candidate breaching several bounds cites them ALL', () => {
  it('a BLOCKING turnover bound now refuses the concentration attempt and is CITED alongside the capital budget (M1\'s D1 case: the refusal cited only capital.budget though the projected turnover also breached)', () => {
    // The fixture envelope + a blocking 100 turnover bound (L2's F1-style
    // tight declaration): the desk SIZES inside it (the entry 6 <= 50, the
    // entry+trim turnover 7.5 <= 75 — the sizing spaces honor the turnover
    // class now), and the concentration attempt breaches it BLOCKING.
    const seed = deriveProjectEvidence(envelope({
      constraintSet: {
        ...launchedConstraintSet(),
        constraints: [
          ...launchedConstraintSet().constraints,
          { id: 'c-3', domain: 'action', subject: 'costs.dailyTurnover', predicate: { kind: 'limit.max', bound: 100 }, severity: 'blocking' },
        ],
      } as ConstraintSetStatement,
    }));
    expect(seed).not.toBeNull();
    if (seed === null) return;
    // Every routed fill is inside EVERY declared bound — the limits stamp is
    // the computed verdict (pass), never a fixed stamp.
    const routed = seed.submissions.filter((row) => row.kind === 'routed');
    expect(routed).toHaveLength(2);
    for (const row of routed) {
      const limitsCheck = (row.riskChecks ?? []).find((check) => check.dimension === 'limits');
      expect(limitsCheck?.outcome).toBe('pass');
      const turnoverEvaluation = (row.limitsEvaluation ?? []).find((evaluation) => evaluation.constraintId === 'c-3');
      expect(turnoverEvaluation?.verdict).toBe('pass');
    }
    const entryTurnover = (routed[0]?.limitsEvaluation ?? []).find((evaluation) => evaluation.constraintId === 'c-3');
    expect(entryTurnover?.observed).toBe('6'); // 0 prior + the entry's own 6 — inside the 100 bound
    const trimTurnover = (routed[1]?.limitsEvaluation ?? []).find((evaluation) => evaluation.constraintId === 'c-3');
    expect(trimTurnover?.observed).toBe('7.5'); // the day's 6 + the trim's own 1.5 — inside the 100 bound
    // The concentration candidate breaches BOTH the capital budget and the
    // turnover bound — and the refusal CITES BOTH (F-8: every breached
    // bound, each with its own class-true observed value).
    const refusal = seed.submissions.find((row) => row.kind === 'refused');
    expect(refusal).toBeDefined();
    if (refusal === undefined || refusal.kind !== 'refused') return;
    const citations = (refusal.refusal as { readonly refusals: readonly { readonly constraintId: string; readonly subject: string; readonly severity: string; readonly observed: string }[] }).refusals;
    expect(citations.map((citation) => citation.constraintId)).toEqual(['k-capital-budget', 'c-3']);
    expect(citations[1]).toMatchObject({ subject: 'costs.dailyTurnover', severity: 'blocking', observed: '10007.4996' }); // the day's 7.5 + the candidate's own 9999.9996
    // The prose cites every breached bound too — itemized per class.
    expect(refusal.decisionRationale).toContain('10007.4996');
    expect(refusal.decisionRationale).toContain('costs.dailyTurnover');
  });

  it('a declared position cap of 1 OMITS the trim (the desk adds no second position it cannot fit) and the concentration attempt breaches the cap by one — cited (L2\'s F3 live stress, closed)', () => {
    // L2's F3: a cap-1 desk stood 2 concurrent positions under a declared
    // cap of 1 (the pre-wave gate never evaluated the class). Post-FW-37-A
    // the trim is omitted (no room for a second position) and the
    // concentration attempt — a THIRD position against a cap of 1 — is
    // refused with the count arithmetic cited.
    const seed = deriveProjectEvidence(envelope({
      constraintSet: {
        ...launchedConstraintSet(),
        constraints: [
          ...launchedConstraintSet().constraints,
          { id: 'c-2', domain: 'state', subject: 'position.grossExposure', predicate: { kind: 'limit.max', bound: 1 }, severity: 'blocking' },
        ],
      } as ConstraintSetStatement,
    }));
    expect(seed).not.toBeNull();
    if (seed === null) return;
    const routed = seed.submissions.filter((row) => row.kind === 'routed');
    const refused = seed.submissions.filter((row) => row.kind === 'refused');
    expect(routed).toHaveLength(1); // the entry only — the trim is honestly OMITTED (a cap-1 desk has no room for a second position)
    expect(refused).toHaveLength(1);
    const refusal = refused[0];
    if (refusal.kind !== 'refused') return;
    const citations = (refusal.refusal as { readonly refusals: readonly { readonly constraintId: string; readonly observed: string }[] }).refusals;
    expect(citations.map((citation) => citation.constraintId)).toEqual(['k-capital-budget', 'c-2']);
    expect(citations[1]?.observed).toBe('2'); // 1 prior open position + this candidate's 1 new position = 2 vs the declared cap 1 — exceeded by one
    const entryPosition = (routed[0]?.limitsEvaluation ?? []).find((evaluation) => evaluation.constraintId === 'c-2');
    expect(entryPosition?.verdict).toBe('pass'); // the single position is AT the cap, not over
    expect(entryPosition?.observed).toBe('1');
  });

  it('a declared CONCENTRATION fraction bound evaluates at every candidate — the first position is honestly 100% of the projected book (advisory_breach, routed), and the concentration attempt is CITED with the itemized fraction arithmetic (L2\'s declared 0.25)', () => {
    // L2's declared 0.25 concentration bound, ADVISORY (L2's own severity
    // class): the entry routes with the honest advisory_breach stamp — the
    // FIRST position is 100% of the projected book by arithmetic truth
    // (candidate 6 / projected 6 = 1), never a silent pass — the trim lands
    // inside (1.5 / 7.5 = 0.2), and the concentration attempt breaches the
    // fraction bound and is CITED alongside the capital budget (F-8: every
    // breached bound, each with its own class-true observed value).
    const seed = deriveProjectEvidence(envelope({
      constraintSet: {
        ...launchedConstraintSet(),
        constraints: [
          ...launchedConstraintSet().constraints,
          { id: 'c-5', domain: 'state', subject: 'position.concentration', predicate: { kind: 'limit.max', bound: 0.25 }, severity: 'advisory' },
        ],
      } as ConstraintSetStatement,
    }));
    expect(seed).not.toBeNull();
    if (seed === null) return;
    const routed = seed.submissions.filter((row) => row.kind === 'routed');
    expect(routed).toHaveLength(2);
    // The entry's OWN concentration evaluation: the first position IS the
    // whole projected book — fraction 1 — the honest breach verdict, and the
    // row's limits stamp is the COMPUTED advisory_breach (an advisory bound
    // warns, never blocks — the entry still routes).
    const entryConcentration = (routed[0]?.limitsEvaluation ?? []).find((evaluation) => evaluation.constraintId === 'c-5');
    expect(entryConcentration?.verdict).toBe('breach');
    expect(entryConcentration?.observed).toBe('1');
    expect(entryConcentration?.severity).toBe('advisory'); // derivable — the declared severity stands
    expect(entryConcentration?.arithmetic).toContain('this candidate\'s own notional 6 / the projected total book 6 (prior 0 + candidate 6) = the concentration fraction 1');
    const entryLimitsCheck = (routed[0]?.riskChecks ?? []).find((check) => check.dimension === 'limits');
    expect(entryLimitsCheck?.outcome).toBe('advisory_breach'); // the computed stamp — never a fixed pass
    // The trim's own evaluation: 1.5 / 7.5 = 0.2 — inside the 0.25 bound, pass.
    const trimConcentration = (routed[1]?.limitsEvaluation ?? []).find((evaluation) => evaluation.constraintId === 'c-5');
    expect(trimConcentration?.verdict).toBe('pass');
    expect(trimConcentration?.observed).toBe('0.2');
    // The concentration attempt: 9999.9996 / 10007.4996 = 0.99925 — past the
    // 0.25 bound, CITED with its own class-true observed value.
    const refusal = seed.submissions.find((row) => row.kind === 'refused');
    expect(refusal).toBeDefined();
    if (refusal === undefined || refusal.kind !== 'refused') return;
    const citations = (refusal.refusal as { readonly refusals: readonly { readonly constraintId: string; readonly subject: string; readonly severity: string; readonly observed: string }[] }).refusals;
    expect(citations.map((citation) => citation.constraintId)).toEqual(['k-capital-budget', 'c-5']);
    expect(citations[1]).toMatchObject({ subject: 'position.concentration', severity: 'advisory', observed: '0.99925' });
    // The prose cites the concentration breach too — itemized per class.
    expect(refusal.decisionRationale).toContain('0.99925');
    expect(refusal.decisionRationale).toContain('position.concentration');
  });

  it('a BLOCKING concentration bound below 1 honestly refuses the FIRST candidate (the first position is 100% of the projected book — fraction 1, the arithmetic truth) — the desk executes nothing (the honest emptiness, never a fabricated pass)', () => {
    // The class's own edge, stated honestly: a desk's FIRST position is
    // always the whole projected book, so a blocking fraction bound below 1
    // refuses every first candidate by arithmetic. The gate neither
    // special-cases the first position nor fabricates a denominator — the
    // desk honestly executes nothing (the existing blocking-breach-at-entry
    // law), and the mandate's own arithmetic is the reason.
    const seed = deriveProjectEvidence(envelope({
      constraintSet: {
        ...launchedConstraintSet(),
        constraints: [
          ...launchedConstraintSet().constraints,
          { id: 'c-5', domain: 'state', subject: 'position.concentration', predicate: { kind: 'limit.max', bound: 0.25 }, severity: 'blocking' },
        ],
      } as ConstraintSetStatement,
    }));
    expect(seed).toBeNull(); // the gate refuses the very first order — the desk honestly executes nothing
  });
});
