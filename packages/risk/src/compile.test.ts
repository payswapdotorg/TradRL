/**
 * @tradrl/risk — the constraint-compiler tests: control-domain
 * ConstraintSet mirrors -> limit records (the pure function), with the
 * compile-law negatives.
 */

import { describe, expect, it } from 'vitest';

import { compileRiskPolicy } from './compile';
import type { ConstraintSetMirror } from './control-mirror';
import { isConstraintSetMirror } from './control-mirror';
import { canonicalDecimalOfFiniteNumber } from './decimals';
import { GOAL, PROJECT, TENANT, T0, fixtureConstraintSet, fixturePolicy, unwrap } from './test-fixtures';

describe('compileRiskPolicy — the pure function', () => {
  it('compiles every risk constraint into the RIGHT limit kind with the RIGHT bound', () => {
    const policy = fixturePolicy();
    // The named class record.
    const crypto = policy.classLimits.find((limit) => limit.instrumentClass === 'crypto');
    expect(crypto).toBeDefined();
    if (crypto !== undefined) {
      expect(crypto.maxOrderSize).toBe('2');
      expect(crypto.maxOrderNotional).toBe('120000');
      expect(crypto.maxPositionSize).toBe('3');
      expect(crypto.maxPositionNotional).toBe('150000');
    }
    // The unqualified subjects compiled to the '*' catch-all.
    const catchAll = policy.classLimits.find((limit) => limit.instrumentClass === '*');
    expect(catchAll).toBeDefined();
    if (catchAll !== undefined) {
      expect(catchAll.maxOrderSize).toBe('1');
      expect(catchAll.maxOrderNotional).toBe('60000');
      expect(catchAll.maxPositionSize).toBe('2');
      expect(catchAll.maxPositionNotional).toBe('110000');
    }
    // The portfolio kinds.
    expect(policy.concentration).toEqual({ maxConcentrationRatio: '0.9', ratioPrecision: 6 });
    expect(policy.drawdown).toEqual({ maxDrawdown: '10000' });
    expect(policy.leverage).toEqual({ maxLeverageRatio: '1.5', ratioPrecision: 6 });
    // The compilation lineage: every risk-bearing blocking constraint id.
    expect(policy.compiledFrom).toEqual([
      'c-order-size-all',
      'c-order-notional-all',
      'c-position-size-all',
      'c-position-notional-all',
      'c-order-size-crypto',
      'c-order-notional-crypto',
      'c-position-size-crypto',
      'c-position-notional-crypto',
      'c-concentration',
      'c-drawdown',
      'c-leverage',
    ]);
    // The lineage refs ride the policy (L9).
    expect(policy.constraintSet).toEqual({ id: 'cs-risk-fixture', version: 1 });
    expect(policy.goal).toEqual(GOAL);
  });

  it('is deterministic: the same inputs compile to the byte-identical policy (L9)', () => {
    const first = fixturePolicy();
    const second = fixturePolicy();
    expect(first).toEqual(second);
    expect(first.policyId).toBe(second.policyId);
  });

  it('a REVISION compiles superseding the previous version (the L11 trail input)', () => {
    const genesis = fixturePolicy();
    const revised = unwrap(
      compileRiskPolicy({
        constraintSet: fixtureConstraintSet(),
        goal: GOAL,
        tenant: TENANT as never,
        project: PROJECT as never,
        asOf: (T0 - 40_000) as never,
        ratioPrecision: 8,
        supersedes: { policyId: genesis.policyId, version: genesis.version },
      }),
    );
    expect(revised.version).toBe(2);
    expect(revised.supersedes).toEqual({ policyId: genesis.policyId, version: 1 });
    expect(revised.concentration?.ratioPrecision).toBe(8);
  });
});

describe('compileRiskPolicy — the compile-law negatives', () => {
  const base = {
    constraintSet: fixtureConstraintSet(),
    goal: GOAL,
    tenant: TENANT as never,
    project: PROJECT as never,
    asOf: (T0 - 50_000) as never,
    ratioPrecision: 6,
  };

  it('rejects a constraint set from another tenant (L12 — cross-tenant compilation is inexpressible)', () => {
    const foreign = { ...fixtureConstraintSet(), tenantId: 'tenant-beta' } as ConstraintSetMirror;
    const result = compileRiskPolicy({ ...base, constraintSet: foreign });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('tenant_missing');
  });

  it('rejects a structurally invalid constraint set', () => {
    const result = compileRiskPolicy({ ...base, constraintSet: { nope: true } });
    expect(result.ok).toBe(false);
    expect(isConstraintSetMirror({ nope: true })).toBe(false);
  });

  it("rejects predicates that are not limit.max (a risk cap is a maximum)", () => {
    const set = {
      ...fixtureConstraintSet(),
      constraints: [{ id: 'c-bad', domain: 'state', subject: 'risk.drawdown', predicate: { kind: 'limit.min', bound: 100 }, severity: 'blocking' }],
    } as unknown;
    const result = compileRiskPolicy({ ...base, constraintSet: set });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('risk_constraint_uncompilable');
      expect(result.errors[0]?.message).toContain('limit.max');
    }
  });

  it('rejects a risk subject outside the grammar (the author intended a risk constraint)', () => {
    const set = {
      ...fixtureConstraintSet(),
      constraints: [{ id: 'c-bad', domain: 'state', subject: 'risk.novel_measure', predicate: { kind: 'limit.max', bound: 5 }, severity: 'blocking' }],
    } as unknown;
    const result = compileRiskPolicy({ ...base, constraintSet: set });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('risk_constraint_uncompilable');
  });

  it('rejects a partial class record (all four caps or none — no default caps)', () => {
    const set = {
      ...fixtureConstraintSet(),
      constraints: [
        { id: 'c-1', domain: 'state', subject: 'risk.position_size.equity', predicate: { kind: 'limit.max', bound: 5 }, severity: 'blocking' },
        { id: 'c-2', domain: 'state', subject: 'risk.position_notional.equity', predicate: { kind: 'limit.max', bound: 50000 }, severity: 'blocking' },
      ],
    } as unknown;
    const result = compileRiskPolicy({ ...base, constraintSet: set });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('risk_constraint_uncompilable');
      expect(result.errors[0]?.message).toContain('order_size');
    }
  });

  it('rejects a zero bound (refuse by policy shape, not magic numbers)', () => {
    const set = {
      ...fixtureConstraintSet(),
      constraints: [{ id: 'c-zero', domain: 'state', subject: 'risk.drawdown', predicate: { kind: 'limit.max', bound: 0 }, severity: 'blocking' }],
    } as unknown;
    const result = compileRiskPolicy({ ...base, constraintSet: set });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain('zero cap');
  });

  it('rejects a concentration bound above 1', () => {
    const set = {
      ...fixtureConstraintSet(),
      constraints: [{ id: 'c-conc', domain: 'state', subject: 'risk.concentration', predicate: { kind: 'limit.max', bound: 1.2 }, severity: 'blocking' }],
    } as unknown;
    const result = compileRiskPolicy({ ...base, constraintSet: set });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain('exceeds 1');
  });

  it('rejects duplicate (kind, class) declarations', () => {
    const set = {
      ...fixtureConstraintSet(),
      constraints: [
        { id: 'c-a', domain: 'state', subject: 'risk.position_size', predicate: { kind: 'limit.max', bound: 2 }, severity: 'blocking' },
        { id: 'c-b', domain: 'state', subject: 'risk.position_size', predicate: { kind: 'limit.max', bound: 3 }, severity: 'blocking' },
      ],
    } as unknown;
    const result = compileRiskPolicy({ ...base, constraintSet: set });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain('duplicate');
  });

  it('rejects non-state/action domains (observations and outcomes are the evaluation lane\'s)', () => {
    const set = {
      ...fixtureConstraintSet(),
      constraints: [{ id: 'c-obs', domain: 'outcome', subject: 'risk.drawdown', predicate: { kind: 'limit.max', bound: 1000 }, severity: 'blocking' }],
    } as unknown;
    const result = compileRiskPolicy({ ...base, constraintSet: set });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain('STATE or ACTION');
  });

  it('ignores non-risk subjects and does not compile advisories (documented, never silently dropped by THIS lane)', () => {
    const set = {
      ...fixtureConstraintSet(),
      constraints: [
        // The strategy lane's business (L16).
        { id: 'c-strategy', domain: 'state', subject: 'state.positions', predicate: { kind: 'limit.max', bound: 5 }, severity: 'blocking' },
        // An advisory risk constraint rides intents (the T018 discipline).
        { id: 'c-advisory', domain: 'state', subject: 'risk.leverage', predicate: { kind: 'limit.max', bound: 9 }, severity: 'advisory' },
      ],
    } as unknown as ConstraintSetMirror;
    const policy = unwrap(compileRiskPolicy({ ...base, constraintSet: set }));
    expect(policy.leverage).toBeNull();
    expect(policy.compiledFrom).toEqual([]);
    expect(policy.classLimits).toEqual([]);
  });
});

describe('canonicalDecimalOfFiniteNumber — the declared bridge', () => {
  it('compiles bounds to their shortest round-trip decimal form (never the binary expansion)', () => {
    expect(canonicalDecimalOfFiniteNumber(0.1)).toBe('0.1');
    expect(canonicalDecimalOfFiniteNumber(0.9)).toBe('0.9');
    expect(canonicalDecimalOfFiniteNumber(10000)).toBe('10000');
    expect(canonicalDecimalOfFiniteNumber(1.5)).toBe('1.5');
    expect(canonicalDecimalOfFiniteNumber(120000)).toBe('120000');
  });

  it('expands exponent forms exactly by shifting the mantissa (string arithmetic, no float mediation)', () => {
    expect(canonicalDecimalOfFiniteNumber(1e-7)).toBe('0.0000001');
    expect(canonicalDecimalOfFiniteNumber(1.5e3)).toBe('1500');
    expect(canonicalDecimalOfFiniteNumber(2.5e-2)).toBe('0.025');
  });

  it('rejects non-finite and non-numeric values (null, never a guess)', () => {
    expect(canonicalDecimalOfFiniteNumber(Number.NaN)).toBeNull();
    expect(canonicalDecimalOfFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(canonicalDecimalOfFiniteNumber('0.1')).toBeNull();
    expect(canonicalDecimalOfFiniteNumber(null)).toBeNull();
  });
});
