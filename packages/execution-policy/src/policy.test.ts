/**
 * @tradrl/execution-policy — the ExecutionPolicy tests: the L8
 * TOTALITY law (the existential law of this lane), credential opacity,
 * the check-order laws and content addressing.
 *
 * The negative test "a policy missing ANY check dimension fails
 * validation" enumerates EVERY dimension of CHECK_DIMENSIONS — the
 * acceptance criterion's exact demand. The credential-opacity negative
 * test embeds a credential VALUE under every credential-shaped key
 * form (camel/snake/kebab/upper) and asserts the typed
 * `credential_value_present` error.
 */

import { describe, expect, it } from 'vitest';

import {
  CHECK_DIMENSIONS,
  DEFAULT_CHECK_ORDER,
  PRE_TRADE_CHECK_KINDS,
  describePolicyCoverage,
  isExecutionPolicy,
  policyContentDigest,
  validateExecutionPolicy,
  type ExecutionPolicy,
} from './index';
import { fixturePolicyInput, unwrap } from './test-fixtures';

/** Build a validated fixture policy (or fail loudly). */
function validPolicy(): ExecutionPolicy {
  return unwrap(validateExecutionPolicy(fixturePolicyInput()));
}

describe('ExecutionPolicy — the L8 totality law', () => {
  it('the full-featured fixture validates, freezes and self-describes', () => {
    const policy = validPolicy();
    expect(policy.policyId).toMatch(/^xpol:[0-9a-f]{8}$/);
    expect(isExecutionPolicy(policy)).toBe(true);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(policy.checkOrder).toEqual(DEFAULT_CHECK_ORDER);
    // The coverage summary names every dimension (totality made visible).
    const coverage = describePolicyCoverage(policy);
    for (const dimension of CHECK_DIMENSIONS) {
      expect(coverage).toContain(dimension);
    }
  });

  it('NEGATIVE — a policy missing ANY check dimension fails validation (every dimension enumerated)', () => {
    // The dimension -> the field whose absence omits it (checkOrder's
    // absence omits the declared order; every other field maps 1:1).
    const dimensionFields: readonly [string, string][] = [
      ['kill_switch', 'killSwitch'],
      ['identity', 'identity'],
      ['authorization', 'authorization'],
      ['limits', 'limits'],
      ['venue_permissions', 'venuePermissions'],
      ['rate_limits', 'rateLimits'],
      ['credentials', 'credentials'],
      ['audit', 'audit'],
    ];
    expect(dimensionFields).toHaveLength(CHECK_DIMENSIONS.length);
    for (const [dimension, field] of dimensionFields) {
      const broken: Record<string, unknown> = { ...fixturePolicyInput() };
      delete broken[field];
      const result = validateExecutionPolicy(broken);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const missing = result.errors.filter((error) => error.code === 'check_dimension_missing');
        expect(missing.length).toBeGreaterThan(0);
        expect(missing.some((error) => error.path === field || error.path === `policy.${field}`)).toBe(true);
        expect(missing.some((error) => error.message.includes(dimension))).toBe(true);
      }
    }
  });

  it('NEGATIVE — a checkOrder missing one pre-trade kind fails (the policy must order every check it runs)', () => {
    for (const dropped of PRE_TRADE_CHECK_KINDS) {
      const input = fixturePolicyInput();
      const broken: Record<string, unknown> = { ...input, checkOrder: PRE_TRADE_CHECK_KINDS.filter((kind) => kind !== dropped) };
      const result = validateExecutionPolicy(broken);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((error) => error.code === 'invalid_check_order')).toBe(true);
      }
    }
  });

  it('NEGATIVE — a checkOrder that buries the kill switch behind other checks fails (standing dominance)', () => {
    const input = fixturePolicyInput();
    const reordered = ['identity', 'kill_switch', 'authorization', 'limits', 'venue_permissions', 'rate_limits', 'credentials'];
    const result = validateExecutionPolicy({ ...input, checkOrder: reordered });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const order = result.errors.filter((error) => error.code === 'invalid_check_order');
      expect(order.length).toBeGreaterThan(0);
      expect(order[0]?.message).toContain('FIRST');
    }
  });

  it('NEGATIVE — a duplicated check in the order fails (a full permutation, no doubles)', () => {
    const input = fixturePolicyInput();
    const doubled = [...PRE_TRADE_CHECK_KINDS, 'limits' as const];
    const result = validateExecutionPolicy({ ...input, checkOrder: doubled });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'invalid_check_order')).toBe(true);
    }
  });

  it('the LEGAL alternative orders validate (any permutation with the kill switch first)', () => {
    const input = fixturePolicyInput();
    const legal = ['kill_switch', 'venue_permissions', 'identity', 'credentials', 'limits', 'rate_limits', 'authorization'];
    const result = validateExecutionPolicy({ ...input, checkOrder: legal });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.checkOrder).toEqual(legal);
  });
});

describe('ExecutionPolicy — credential opacity (L12)', () => {
  it('NEGATIVE — embedding a credential VALUE fails validation under every key form', () => {
    const keyForms: readonly string[] = ['apiKey', 'api_key', 'API-KEY', 'secret', 'privateKey', 'private-key', 'password', 'passphrase', 'token', 'mnemonic', 'seedPhrase', 'seed_phrase'];
    for (const key of keyForms) {
      const input: Record<string, unknown> = { ...fixturePolicyInput() };
      const note: Record<string, unknown> = {};
      note[key] = 'AKIAIOSFODNN7EXAMPLE';
      input.notes = note; // smuggled anywhere in the tree
      const result = validateExecutionPolicy(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((error) => error.code === 'credential_value_present')).toBe(true);
      }
    }
  });

  it('NEGATIVE — a credential value nested deep in the record fails (the scan is total)', () => {
    const input: Record<string, unknown> = { ...fixturePolicyInput() };
    input.learning = {
      trialId: 'trial-1',
      armId: 'arm-1',
      trajectoryId: 'traj-1',
      notes: { config: { secret: 'hunter2' } },
    };
    const result = validateExecutionPolicy(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'credential_value_present' && error.path.includes('secret'))).toBe(true);
    }
  });

  it('POSITIVE — opaque cred: refs pass (the only expressible form)', () => {
    const policy = validPolicy();
    expect(policy.credentials[0]?.credentialRef).toMatch(/^cred:/);
    expect(validateExecutionPolicy(fixturePolicyInput()).ok).toBe(true);
  });

  it('NEGATIVE — a credential binding whose ref is not a cred: ref fails', () => {
    const input = fixturePolicyInput();
    const broken = {
      ...input,
      credentials: [{ venue: 'REFSIM', credentialRef: 'AKIAIOSFODNN7EXAMPLE' }],
    };
    const result = validateExecutionPolicy(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'invalid_field' && error.path.includes('credentials'))).toBe(true);
    }
  });
});

describe('ExecutionPolicy — declaration coherence', () => {
  it('NEGATIVE — a missing tenant/project scope fails with tenant_missing (L12)', () => {
    const input: Record<string, unknown> = { ...fixturePolicyInput() };
    delete input.tenant;
    const result = validateExecutionPolicy(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'tenant_missing')).toBe(true);

    const noProject: Record<string, unknown> = { ...fixturePolicyInput() };
    delete noProject.project;
    const result2 = validateExecutionPolicy(noProject);
    expect(result2.ok).toBe(false);
    if (!result2.ok) expect(result2.errors.some((error) => error.code === 'tenant_missing')).toBe(true);
  });

  it('NEGATIVE — duplicate limit classes / venue pairs / budgets / bindings fail', () => {
    const base = fixturePolicyInput();
    const dupClass = { ...base, limits: [...base.limits, base.limits[0]] };
    expect(validateExecutionPolicy(dupClass).ok).toBe(false);

    const dupPair = { ...base, venuePermissions: [...base.venuePermissions, base.venuePermissions[0]] };
    expect(validateExecutionPolicy(dupPair).ok).toBe(false);

    const dupBudget = { ...base, rateLimits: [...base.rateLimits, base.rateLimits[0]] };
    expect(validateExecutionPolicy(dupBudget).ok).toBe(false);

    const dupBinding = { ...base, credentials: [...base.credentials, base.credentials[0]] };
    expect(validateExecutionPolicy(dupBinding).ok).toBe(false);
  });

  it('NEGATIVE — a zero cap is inexpressible (canonical positive decimals only)', () => {
    const input = fixturePolicyInput();
    const broken = {
      ...input,
      limits: [{ instrumentClass: '*', maxOrderSize: '0', maxOrderNotional: '0', maxPositionSize: '0', maxPositionNotional: '0' }],
    };
    const result = validateExecutionPolicy(broken);
    expect(result.ok).toBe(false);
  });
});

describe('ExecutionPolicy — content addressing (L9)', () => {
  it('the same declaration always yields the same policy id', () => {
    const first = validPolicy();
    const second = validPolicy();
    expect(first.policyId).toBe(second.policyId);
    expect(policyContentDigest(fixturePolicyInput())).toBe(policyContentDigest(fixturePolicyInput()));
  });

  it('NEGATIVE — a supplied id that disagrees with the content fails (identity IS content)', () => {
    const input = fixturePolicyInput();
    const result = validateExecutionPolicy({ ...input, policyId: 'xpol:deadbeef' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('invalid_state');
    }
  });

  it('a revised declaration is a NEW identity (versions are immutable revisions)', () => {
    const v1 = validPolicy();
    const v2 = unwrap(validateExecutionPolicy({ ...fixturePolicyInput(), version: 2 }));
    expect(v1.policyId).not.toBe(v2.policyId);
    expect(v2.version).toBe(2);
  });

  it('field order at construction does not change the identity (canonical JSON)', () => {
    const input = fixturePolicyInput();
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort().reverse()) {
      reordered[key] = (input as Record<string, unknown>)[key];
    }
    const result = validateExecutionPolicy(reordered);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.policyId).toBe(v1Id());
  });

  it('the validated policy is deeply frozen (immutability discipline)', () => {
    const policy = validPolicy();
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.identity)).toBe(true);
    expect(Object.isFrozen(policy.limits)).toBe(true);
    expect(Object.isFrozen(policy.limits[0])).toBe(true);
    expect(() => {
      (policy as { version: number }).version = 99;
    }).toThrow();
  });
});

/** The fixture policy's id (shared across the content-addressing tests). */
function v1Id(): string {
  return validPolicy().policyId;
}
