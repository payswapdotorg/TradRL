/**
 * @tradrl/risk — the RiskPolicy tests: validation totality, the L7
 * trip wire, the exact-decimal trip wire, the L11 version laws,
 * determinism and immutability.
 */

import { describe, expect, it } from 'vitest';

import { isDeeplyFrozen, isRecord } from './primitives';
import { acceptanceViolations, isRiskPolicy, validateRiskPolicy } from './policy';
import { fixturePolicy, fixturePolicyInput, validateFixturePolicy } from './test-fixtures';

describe('validateRiskPolicy — the happy path', () => {
  it('validates the hand-declared full-featured policy (every limit present)', () => {
    const result = validateFixturePolicy(fixturePolicyInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const policy = result.value;
    expect(policy.policyId.startsWith('rpol:')).toBe(true);
    expect(policy.classLimits).toHaveLength(2);
    expect(policy.concentration).not.toBeNull();
    expect(policy.drawdown).not.toBeNull();
    expect(policy.leverage).not.toBeNull();
    expect(policy.compiledFrom).toEqual(['c-order-size-crypto', 'c-concentration']);
    expect(isRiskPolicy(policy)).toBe(true);
  });

  it('content-addresses identity: equal declarations yield the same id; drifted ones do not', () => {
    const first = validateFixturePolicy(fixturePolicyInput());
    const second = validateFixturePolicy(fixturePolicyInput());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.policyId).toBe(second.value.policyId);
    const drifted = validateFixturePolicy(fixturePolicyInput({ asOf: (first.value.asOf + 1) as never }));
    expect(drifted.ok).toBe(true);
    if (drifted.ok) expect(drifted.value.policyId).not.toBe(first.value.policyId);
  });

  it('a supplied id that disagrees with the content fails (identity is content-addressed, L9)', () => {
    const valid = validateFixturePolicy(fixturePolicyInput());
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const forged = validateFixturePolicy(fixturePolicyInput({ policyId: 'rpol:deadbeef' }));
    expect(forged.ok).toBe(false);
    if (forged.ok) return;
    expect(forged.errors[0]?.code).toBe('invalid_state');
  });

  it('the validated policy is deeply frozen (append-only value object)', () => {
    const result = validateFixturePolicy(fixturePolicyInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isDeeplyFrozen(result.value)).toBe(true);
    expect(() => {
      (result.value as unknown as Record<string, unknown>).tenant = 'tenant-other';
    }).toThrow();
  });
});

describe('validateRiskPolicy — the L7 trip wire (the existential law)', () => {
  it('an acceptance threshold embedded anywhere fails with acceptance_threshold_embedded', () => {
    const crimes: readonly [string, Record<string, unknown>][] = [
      ['score on the root', { score: 0.8 }],
      ['acceptance threshold on the root', { acceptanceThreshold: '0.7' }],
      ['a verdict under a limit record', { classLimits: [{ instrumentClass: '*', maxOrderSize: '1', maxOrderNotional: '60000', maxPositionSize: '2', maxPositionNotional: '110000', verdict: 'pass' }] }],
      ['minScore under concentration', { concentration: { maxConcentrationRatio: '0.9', ratioPrecision: 6, minScore: 1 } }],
      ['pass_threshold under drawdown', { drawdown: { maxDrawdown: '10000', pass_threshold: true } }],
    ];
    for (const [name, overrides] of crimes) {
      const result = validateFixturePolicy(fixturePolicyInput(overrides));
      expect(result.ok, name).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((error) => error.code === 'acceptance_threshold_embedded'), name).toBe(true);
      }
    }
  });

  it('the structural guard rejects acceptance vocabulary too (the guard half)', () => {
    const crime = fixturePolicyInput({ minScore: 3 });
    expect(isRecord(crime)).toBe(true);
    expect(acceptanceViolations(crime)).toEqual(['minScore']);
    expect(isRiskPolicy(crime)).toBe(false);
  });

  it('the scan is case/separator-insensitive and total over the tree', () => {
    const nested = { outer: { inner: [{ 'PASS-THRESHOLD': 1 }] } };
    expect(acceptanceViolations(nested)).toEqual(['outer.inner[0].PASS-THRESHOLD']);
    expect(acceptanceViolations({ unrelated: 'clean', limits: [{ cap: '1' }] })).toEqual([]);
  });

  it('a compiled policy from the fixture set carries NO acceptance vocabulary (clean by construction)', () => {
    const policy = fixturePolicy();
    expect(acceptanceViolations(policy)).toEqual([]);
    expect(isRiskPolicy(policy)).toBe(true);
  });
});

describe('validateRiskPolicy — the exact-decimal trip wire', () => {
  it('a JS number in a bound field fails with decimal_imprecision (float mediation is inexpressible)', () => {
    const crimes: readonly [string, Record<string, unknown>][] = [
      ['class maxOrderSize', { classLimits: [{ instrumentClass: '*', maxOrderSize: 1, maxOrderNotional: '60000', maxPositionSize: '2', maxPositionNotional: '110000' }] }],
      ['class maxOrderNotional', { classLimits: [{ instrumentClass: '*', maxOrderSize: '1', maxOrderNotional: 60000, maxPositionSize: '2', maxPositionNotional: '110000' }] }],
      ['concentration ratio', { concentration: { maxConcentrationRatio: 0.9, ratioPrecision: 6 } }],
      ['drawdown magnitude', { drawdown: { maxDrawdown: 10000 } }],
      ['leverage ratio', { leverage: { maxLeverageRatio: 1.5, ratioPrecision: 6 } }],
    ];
    for (const [name, overrides] of crimes) {
      const result = validateFixturePolicy(fixturePolicyInput(overrides));
      expect(result.ok, name).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((error) => error.code === 'decimal_imprecision'), name).toBe(true);
      }
    }
  });

  it('a zero or malformed bound fails as invalid_field (refuse by policy shape)', () => {
    const zero = validateFixturePolicy(fixturePolicyInput({ classLimits: [{ instrumentClass: '*', maxOrderSize: '0', maxOrderNotional: '60000', maxPositionSize: '2', maxPositionNotional: '110000' }] }));
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors[0]?.code).toBe('invalid_field');

    const negative = validateFixturePolicy(fixturePolicyInput({ drawdown: { maxDrawdown: '-10000' } }));
    expect(negative.ok).toBe(false);
  });

  it('a concentration ratio above 1 fails (a share of gross cannot exceed the whole)', () => {
    const result = validateFixturePolicy(fixturePolicyInput({ concentration: { maxConcentrationRatio: '1.1', ratioPrecision: 6 } }));
    expect(result.ok).toBe(false);
  });
});

describe('validateRiskPolicy — the L11 version laws', () => {
  it('version 1 with a supersedes pointer fails', () => {
    const result = validateFixturePolicy(fixturePolicyInput({ supersedes: { policyId: 'rpol:aaaaaaaa', version: 1 } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toBe('policy.supersedes');
  });

  it('version N > 1 without a supersedes pointer fails', () => {
    const result = validateFixturePolicy(fixturePolicyInput({ version: 2 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toBe('policy.supersedes');
  });

  it('version N pointing at anything but N-1 fails (contiguous chains only)', () => {
    const result = validateFixturePolicy(fixturePolicyInput({ version: 3, supersedes: { policyId: 'rpol:aaaaaaaa', version: 1 } }));
    expect(result.ok).toBe(false);
  });
});

describe('validateRiskPolicy — the collect-all discipline', () => {
  it('missing scope/lineage fields are each reported (tenant, project, goal, constraint set)', () => {
    const base = fixturePolicyInput();
    const result = validateRiskPolicy({ ...base, tenant: undefined, project: undefined, goal: undefined, constraintSet: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((error) => error.code);
      expect(codes).toContain('tenant_missing');
      expect(codes).toContain('lineage_gap');
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('duplicate class records fail (one record per class)', () => {
    const duplicate = fixturePolicyInput({
      classLimits: [
        { instrumentClass: 'crypto', maxOrderSize: '2', maxOrderNotional: '120000', maxPositionSize: '3', maxPositionNotional: '150000' },
        { instrumentClass: 'crypto', maxOrderSize: '1', maxOrderNotional: '60000', maxPositionSize: '2', maxPositionNotional: '110000' },
      ],
    });
    const result = validateFixturePolicy(duplicate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.path.includes('instrumentClass'))).toBe(true);
  });

  it('duplicate compiledFrom ids fail', () => {
    const result = validateFixturePolicy(fixturePolicyInput({ compiledFrom: ['c-a', 'c-a'] }));
    expect(result.ok).toBe(false);
  });
});
