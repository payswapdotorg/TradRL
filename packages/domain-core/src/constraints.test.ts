import { describe, expect, it } from 'vitest';
import { Timestamp } from './primitives';
import {
  ConstraintEvaluationContext,
  ConstraintSet,
  Predicate,
  evaluateConstraintSet,
  isConstraint,
  isConstraintEvaluationContext,
  isConstraintSet,
  isPredicate,
} from './constraints';
import { ConstraintSetId } from './ids';

const at = (s: string) => s as Timestamp;
const setId = 'cs_risk_1' as ConstraintSetId;

function makeSet(overloads: Partial<ConstraintSet> = {}): ConstraintSet {
  const base: ConstraintSet = {
    id: setId,
    version: 2,
    name: 'project guardrails',
    constraints: [
      {
        id: 'max-gross-exposure',
        domain: 'state',
        subject: 'portfolio.grossExposure',
        predicate: { kind: 'limit.max', bound: 1_000_000 },
        severity: 'blocking',
        description: 'Gross exposure must stay under 1,000,000 USD.',
      },
      {
        id: 'min-confidence',
        domain: 'action',
        subject: 'decision.confidence',
        predicate: { kind: 'limit.min', bound: 0.6 },
        severity: 'advisory',
      },
    ],
    supersedes: { id: setId, version: 1 },
    provenance: { origin: 'compiled', sourceText: 'never risk more than a million' },
    createdAt: at('2027-01-03T08:00:00Z'),
  } as ConstraintSet;
  return { ...base, ...overloads };
}

const emptyContext: ConstraintEvaluationContext = {
  observations: {},
  state: {},
  actions: {},
  outcomes: {},
};

describe('isPredicate / isConstraint guards', () => {
  it('accepts every well-formed predicate kind', () => {
    const valid: Predicate[] = [
      { kind: 'limit.max', bound: 10 },
      { kind: 'limit.min', bound: -1.5 },
      { kind: 'limit.range', min: 0, max: 1 },
      { kind: 'equals', value: 'BTC-USDT' },
      { kind: 'equals', value: 3 },
      { kind: 'equals', value: true },
      { kind: 'notEquals', value: 'sell' },
      { kind: 'oneOf', values: ['buy', 'hold'] },
      { kind: 'flag', expected: false },
    ];
    for (const p of valid) expect(isPredicate(p)).toBe(true);
  });

  it('rejects malformed predicates', () => {
    const invalid: unknown[] = [
      { kind: 'limit.max' }, // missing bound
      { kind: 'limit.max', bound: Number.NaN },
      { kind: 'limit.max', bound: '100' },
      { kind: 'limit.range', min: 5, max: 1 }, // min > max
      { kind: 'limit.range', min: 0 }, // missing max
      { kind: 'equals', value: '' }, // empty string is not a ConstraintValue
      { kind: 'equals', value: null },
      { kind: 'oneOf', values: [] }, // empty allowed set
      { kind: 'oneOf', values: ['ok', ''] }, // empty member
      { kind: 'oneOf', values: 'buy' }, // not an array
      { kind: 'flag', expected: 'yes' },
      { kind: 'unknownKind', bound: 1 },
      'limit.max',
      null,
    ];
    for (const p of invalid) expect(isPredicate(p)).toBe(false);
  });

  it('rejects constraints with malformed subjects or vocabularies', () => {
    const invalid: unknown[] = [
      { id: '', domain: 'state', subject: 'portfolio.grossExposure', predicate: { kind: 'flag', expected: true }, severity: 'blocking' },
      { id: 'c1', domain: 'unknown', subject: 'portfolio.grossExposure', predicate: { kind: 'flag', expected: true }, severity: 'blocking' },
      { id: 'c1', domain: 'state', subject: 'not a subject', predicate: { kind: 'flag', expected: true }, severity: 'blocking' },
      { id: 'c1', domain: 'state', subject: 'leading..dot', predicate: { kind: 'flag', expected: true }, severity: 'advisory' },
      { id: 'c1', domain: 'state', subject: '1bad.start', predicate: { kind: 'flag', expected: true }, severity: 'advisory' },
      { id: 'c1', domain: 'state', subject: 'portfolio.grossExposure', predicate: { kind: 'flag', expected: true }, severity: 'fatal' },
      { id: 'c1', domain: 'state', subject: 'portfolio.grossExposure', predicate: { kind: 'flag', expected: true }, severity: 'advisory', description: '' },
    ];
    for (const c of invalid) expect(isConstraint(c)).toBe(false);
  });
});

describe('isConstraintSet versioning invariants', () => {
  it('accepts a well-formed versioned set with lineage', () => {
    expect(isConstraintSet(makeSet())).toBe(true);
  });

  it('rejects version 0, non-integer versions and duplicate constraint ids', () => {
    expect(isConstraintSet(makeSet({ version: 0 }))).toBe(false);
    expect(isConstraintSet(makeSet({ version: 1.5 }))).toBe(false);
    const dup = makeSet({
      constraints: [
        { id: 'c', domain: 'state', subject: 'a.b', predicate: { kind: 'flag', expected: true }, severity: 'advisory' },
        { id: 'c', domain: 'state', subject: 'a.b', predicate: { kind: 'flag', expected: false }, severity: 'advisory' },
      ],
    });
    expect(isConstraintSet(dup)).toBe(false);
  });

  it('rejects supersedes lineage that is not strictly older for the same id', () => {
    expect(isConstraintSet(makeSet({ supersedes: { id: setId, version: 2 } }))).toBe(false); // equal
    expect(isConstraintSet(makeSet({ supersedes: { id: setId, version: 3 } }))).toBe(false); // newer
    expect(isConstraintSet(makeSet({ supersedes: { id: setId, version: 1 } }))).toBe(true); // older
    // A different set id may be superseded (succession/merge lineage).
    expect(
      isConstraintSet(makeSet({ supersedes: { id: 'cs_other' as ConstraintSetId, version: 9 } })),
    ).toBe(true);
    expect(isConstraintSet(makeSet({ supersedes: { id: setId, version: 0 } }))).toBe(false); // invalid ref
  });
});

describe('isConstraintEvaluationContext', () => {
  it('accepts a structurally valid context and rejects malformed maps', () => {
    expect(isConstraintEvaluationContext(emptyContext)).toBe(true);
    expect(
      isConstraintEvaluationContext({
        observations: { 'feat.momentum': 0.31 },
        state: { 'portfolio.grossExposure': 100 },
        actions: {},
        outcomes: { 'pnl.realized': -12.5 },
      }),
    ).toBe(true);

    const invalid: unknown[] = [
      {},
      { observations: {}, state: {}, actions: {} }, // missing outcomes
      { observations: {}, state: {}, actions: {}, outcomes: null },
      { observations: { 'bad key': 1 }, state: {}, actions: {}, outcomes: {} },
      { observations: { 'ok.ok': Number.NaN }, state: {}, actions: {}, outcomes: {} },
      { observations: { 'ok.ok': '' }, state: {}, actions: {}, outcomes: {} },
      { observations: { 'ok.ok': null }, state: {}, actions: {}, outcomes: {} },
      { observations: [], state: {}, actions: {}, outcomes: {} }, // array is not a map
    ];
    for (const ctx of invalid) expect(isConstraintEvaluationContext(ctx)).toBe(false);
  });
});

describe('evaluateConstraintSet — predicate execution', () => {
  it('a limit.max constraint accepts values at or below the bound and rejects above', () => {
    const set = makeSet({
      constraints: [
        {
          id: 'max-gross-exposure',
          domain: 'state',
          subject: 'portfolio.grossExposure',
          predicate: { kind: 'limit.max', bound: 1_000_000 },
          severity: 'blocking',
        },
      ],
    });
    const atBound = evaluateConstraintSet(
      set,
      { ...emptyContext, state: { 'portfolio.grossExposure': 1_000_000 } },
      at('2027-02-01T12:00:00Z'),
    );
    expect(atBound.checks[0]?.status).toBe('satisfied');
    expect(atBound.pass).toBe(true);

    const belowBound = evaluateConstraintSet(
      set,
      { ...emptyContext, state: { 'portfolio.grossExposure': 999_999.99 } },
      at('2027-02-01T12:00:00Z'),
    );
    expect(belowBound.checks[0]?.status).toBe('satisfied');

    const aboveBound = evaluateConstraintSet(
      set,
      { ...emptyContext, state: { 'portfolio.grossExposure': 1_000_000.01 } },
      at('2027-02-01T12:00:00Z'),
    );
    expect(aboveBound.checks[0]?.status).toBe('violated');
    expect(aboveBound.blockingViolations).toBe(1);
    expect(aboveBound.pass).toBe(false);
  });

  it('a limit.min constraint rejects below the bound and accepts at/above', () => {
    const set = makeSet({
      constraints: [
        {
          id: 'min-confidence',
          domain: 'action',
          subject: 'decision.confidence',
          predicate: { kind: 'limit.min', bound: 0.6 },
          severity: 'blocking',
        },
      ],
    });
    const evalAt = (confidence: number) =>
      evaluateConstraintSet(
        set,
        { ...emptyContext, actions: { 'decision.confidence': confidence } },
        at('2027-02-01T12:00:00Z'),
      );
    expect(evalAt(0.6).checks[0]?.status).toBe('satisfied');
    expect(evalAt(0.9).checks[0]?.status).toBe('satisfied');
    expect(evalAt(0.59).checks[0]?.status).toBe('violated');
    expect(evalAt(0.59).pass).toBe(false);
  });

  it('a limit.range constraint checks both bounds', () => {
    const set = makeSet({
      constraints: [
        {
          id: 'band',
          domain: 'observation',
          subject: 'regime.volatility',
          predicate: { kind: 'limit.range', min: 0.1, max: 0.4 },
          severity: 'blocking',
        },
      ],
    });
    const evalWith = (v: number) =>
      evaluateConstraintSet(
        set,
        { ...emptyContext, observations: { 'regime.volatility': v } },
        at('2027-02-01T12:00:00Z'),
      );
    expect(evalWith(0.1).checks[0]?.status).toBe('satisfied');
    expect(evalWith(0.4).checks[0]?.status).toBe('satisfied');
    expect(evalWith(0.25).checks[0]?.status).toBe('satisfied');
    expect(evalWith(0.09).checks[0]?.status).toBe('violated');
    expect(evalWith(0.41).checks[0]?.status).toBe('violated');
  });

  it('equals / notEquals / oneOf / flag predicates execute exactly', () => {
    const set = makeSet({
      constraints: [
        { id: 'eq', domain: 'state', subject: 'instrument.symbol', predicate: { kind: 'equals', value: 'BTC-USDT' }, severity: 'advisory' },
        { id: 'ne', domain: 'state', subject: 'session.mode', predicate: { kind: 'notEquals', value: 'closed' }, severity: 'advisory' },
        { id: 'in', domain: 'action', subject: 'order.side', predicate: { kind: 'oneOf', values: ['buy', 'hold'] }, severity: 'advisory' },
        { id: 'flag', domain: 'outcome', subject: 'risk.passed', predicate: { kind: 'flag', expected: true }, severity: 'advisory' },
      ],
    });
    const report = evaluateConstraintSet(
      set,
      {
        observations: {},
        state: { 'instrument.symbol': 'BTC-USDT', 'session.mode': 'open' },
        actions: { 'order.side': 'sell' }, // not in allowed set -> violated
        outcomes: { 'risk.passed': true },
      },
      at('2027-02-01T12:00:00Z'),
    );
    const byId = new Map(report.checks.map((c) => [c.constraintId, c.status]));
    expect(byId.get('eq')).toBe('satisfied');
    expect(byId.get('ne')).toBe('satisfied');
    expect(byId.get('in')).toBe('violated');
    expect(byId.get('flag')).toBe('satisfied');
    // advisory violation does not fail the report
    expect(report.advisoryViolations).toBe(1);
    expect(report.blockingViolations).toBe(0);
    expect(report.pass).toBe(true);
  });

  it('missing subject keys are not_applicable (point-in-time evaluation)', () => {
    const set = makeSet({
      constraints: [
        { id: 'o', domain: 'observation', subject: 'feat.momentum', predicate: { kind: 'limit.max', bound: 1 }, severity: 'blocking' },
      ],
    });
    const report = evaluateConstraintSet(set, emptyContext, at('2027-02-01T12:00:00Z'));
    expect(report.checks[0]?.status).toBe('not_applicable');
    expect(report.checks[0]?.reason).toContain('feat.momentum');
    expect(report.notApplicable).toBe(1);
    // Nothing applicable -> fail-closed ratio 0, and pass stays true (no violations).
    expect(report.satisfiedRatio).toBe(0);
    expect(report.pass).toBe(true);
  });

  it('type mismatches are errors and fail the report (fail-closed)', () => {
    const set = makeSet({
      constraints: [
        { id: 'num', domain: 'state', subject: 'portfolio.grossExposure', predicate: { kind: 'limit.max', bound: 100 }, severity: 'advisory' },
        { id: 'enum', domain: 'action', subject: 'order.side', predicate: { kind: 'oneOf', values: ['buy'] }, severity: 'advisory' },
        { id: 'bool', domain: 'outcome', subject: 'risk.passed', predicate: { kind: 'flag', expected: true }, severity: 'advisory' },
        { id: 'eq-type', domain: 'state', subject: 'instrument.symbol', predicate: { kind: 'equals', value: 'BTC-USDT' }, severity: 'advisory' },
      ],
    });
    const report = evaluateConstraintSet(
      set,
      {
        observations: {},
        state: { 'portfolio.grossExposure': 'high', 'instrument.symbol': 42 },
        actions: { 'order.side': 7 },
        outcomes: { 'risk.passed': 'yes' },
      },
      at('2027-02-01T12:00:00Z'),
    );
    const byId = new Map(report.checks.map((c) => [c.status ? c.constraintId : '', c.status]));
    expect(byId.get('num')).toBe('error');
    expect(byId.get('enum')).toBe('error');
    expect(byId.get('bool')).toBe('error');
    expect(byId.get('eq-type')).toBe('error');
    expect(report.errors).toBe(4);
    expect(report.pass).toBe(false); // errors force failure even when advisory
  });

  it('severity aggregation splits blocking and advisory violations', () => {
    const set = makeSet({
      constraints: [
        { id: 'b1', domain: 'state', subject: 'a.b', predicate: { kind: 'limit.max', bound: 1 }, severity: 'blocking' },
        { id: 'b2', domain: 'state', subject: 'c.d', predicate: { kind: 'limit.max', bound: 1 }, severity: 'blocking' },
        { id: 'a1', domain: 'state', subject: 'e.f', predicate: { kind: 'limit.max', bound: 1 }, severity: 'advisory' },
      ],
    });
    const report = evaluateConstraintSet(
      set,
      { ...emptyContext, state: { 'a.b': 5, 'c.d': 5, 'e.f': 5 } },
      at('2027-02-01T12:00:00Z'),
    );
    expect(report.blockingViolations).toBe(2);
    expect(report.advisoryViolations).toBe(1);
    expect(report.violated).toBe(3);
    expect(report.satisfiedRatio).toBe(0);
    expect(report.pass).toBe(false);
  });

  it('satisfiedRatio counts satisfied over applicable (violations and errors), excluding not_applicable', () => {
    const set = makeSet({
      constraints: [
        { id: 's1', domain: 'state', subject: 'a.b', predicate: { kind: 'limit.max', bound: 10 }, severity: 'blocking' },
        { id: 's2', domain: 'state', subject: 'c.d', predicate: { kind: 'limit.max', bound: 10 }, severity: 'blocking' },
        { id: 'v1', domain: 'state', subject: 'e.f', predicate: { kind: 'limit.max', bound: 1 }, severity: 'blocking' },
        { id: 'n1', domain: 'outcome', subject: 'not.there', predicate: { kind: 'limit.max', bound: 1 }, severity: 'blocking' },
      ],
    });
    const report = evaluateConstraintSet(
      set,
      { ...emptyContext, state: { 'a.b': 1, 'c.d': 2, 'e.f': 99 } },
      at('2027-02-01T12:00:00Z'),
    );
    // satisfied 2, violated 1, not_applicable 1 -> ratio 2/3
    expect(report.satisfiedRatio).toBeCloseTo(2 / 3, 12);
    expect(report.satisfied).toBe(2);
    expect(report.notApplicable).toBe(1);
  });

  it('determinism: same arguments produce identical reports', () => {
    const set = makeSet();
    const ctx: ConstraintEvaluationContext = {
      ...emptyContext,
      state: { 'portfolio.grossExposure': 500_000 },
      actions: { 'decision.confidence': 0.8 },
    };
    const r1 = evaluateConstraintSet(set, ctx, at('2027-02-01T12:00:00Z'));
    const r2 = evaluateConstraintSet(set, ctx, at('2027-02-01T12:00:00Z'));
    expect(r1).toEqual(r2);
  });
});

describe('evaluateConstraintSet — fail-closed on invalid input', () => {
  it('an invalid constraint set fails with invalidReason and no checks', () => {
    const bad = { id: 'cs_risk_1', version: 0, constraints: [] } as unknown as ConstraintSet;
    const report = evaluateConstraintSet(bad, emptyContext, at('2027-02-01T12:00:00Z'));
    expect(report.pass).toBe(false);
    expect(report.invalidReason).toContain('constraint set');
    expect(report.checks).toHaveLength(0);
  });

  it('an invalid evaluation context fails with invalidReason', () => {
    const badCtx = { observations: {} } as unknown as ConstraintEvaluationContext;
    const report = evaluateConstraintSet(makeSet(), badCtx, at('2027-02-01T12:00:00Z'));
    expect(report.pass).toBe(false);
    expect(report.invalidReason).toContain('context');
  });

  it('an invalid evaluatedAt fails with invalidReason', () => {
    const report = evaluateConstraintSet(makeSet(), emptyContext, 'not-a-time' as Timestamp);
    expect(report.pass).toBe(false);
    expect(report.invalidReason).toContain('timestamp');
  });

  it('never throws on garbage input', () => {
    const garbage = [null, undefined, 42, 'x', [], { nonsense: true }] as unknown as ConstraintSet[];
    for (const g of garbage) {
      expect(() => evaluateConstraintSet(g, emptyContext, at('2027-02-01T12:00:00Z'))).not.toThrow();
      const r = evaluateConstraintSet(g, emptyContext, at('2027-02-01T12:00:00Z'));
      expect(r.pass).toBe(false);
    }
  });
});
