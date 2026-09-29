/**
 * @tradrl/risk — the RiskPolicyTrail tests: the L11 append-only
 * evolution law (superseded versions retained, structured reasons) and
 * the rewrite trip wires (splice, edit, truncate, skip, fork).
 */

import { describe, expect, it } from 'vitest';

import {
  appendRiskPolicy,
  currentRiskPolicy,
  isRiskPolicyTrail,
  retainedPolicyVersions,
  startRiskPolicyTrail,
  supersedeRiskPolicy,
  verifyRiskPolicyTrail,
} from './trail';
import { compileRiskPolicy } from './compile';
import { isDeeplyFrozen } from './primitives';
import { GOAL, PROJECT, TENANT, T0, fixtureConstraintSet, fixturePolicy, unwrap } from './test-fixtures';

/** Compile version N of the fixture policy (a drifted bound per version). */
function compileVersion(version: number): ReturnType<typeof fixturePolicy> {
  const genesis = fixturePolicy();
  if (version === 1) return genesis;
  let policy = genesis;
  for (let step = 2; step <= version; step++) {
    const drifted = { ...fixtureConstraintSet(), constraints: fixtureConstraintSet().constraints.map((constraint) =>
      constraint.id === 'c-drawdown' ? { ...constraint, predicate: { kind: 'limit.max' as const, bound: 10000 + step - 1 } } : constraint,
    ) } as never;
    policy = unwrap(
      compileRiskPolicy({
        constraintSet: drifted,
        goal: GOAL,
        tenant: TENANT as never,
        project: PROJECT as never,
        asOf: (T0 - 50_000 + step) as never,
        ratioPrecision: 6,
        supersedes: { policyId: policy.policyId, version: policy.version },
      }),
    );
  }
  return policy;
}

describe('startRiskPolicyTrail / appendRiskPolicy — the L11 evolution', () => {
  it('starts with the genesis (version 1) and verifies green', () => {
    const trail = unwrap(startRiskPolicyTrail(fixturePolicy(), (T0 - 40_000) as never));
    expect(trail.entries).toHaveLength(1);
    expect(currentRiskPolicy(trail).version).toBe(1);
    expect(verifyRiskPolicyTrail(trail).ok).toBe(true);
    expect(isRiskPolicyTrail(trail)).toBe(true);
    expect(isDeeplyFrozen(trail)).toBe(true);
  });

  it('a genesis that is not version 1 fails (a trail starts at the beginning)', () => {
    const v2 = compileVersion(2);
    const result = startRiskPolicyTrail(v2, (T0 - 40_000) as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('policy_history_rewrite');
  });

  it('SUPERSEDE appends the next version and RETAINS the superseded one (L11)', () => {
    const trail = unwrap(startRiskPolicyTrail(compileVersion(1), (T0 - 40_000) as never));
    const superseded = unwrap(appendRiskPolicy(trail, compileVersion(2), 'tighten the drawdown threshold after the Q3 review', (T0 - 30_000) as never));
    expect(superseded.entries).toHaveLength(2);
    // The retention: BOTH versions remain, in order, with the reason.
    const retained = retainedPolicyVersions(superseded);
    expect(retained.map((policy) => policy.version)).toEqual([1, 2]);
    expect(superseded.entries[1]?.reason).toBe('tighten the drawdown threshold after the Q3 review');
    expect(currentRiskPolicy(superseded).version).toBe(2);
    // The original trail is untouched (append-only: a NEW trail).
    expect(trail.entries).toHaveLength(1);
    expect(verifyRiskPolicyTrail(superseded).ok).toBe(true);
  });

  it('the semantic alias is the same function (the Work Order\'s own verb)', () => {
    expect(supersedeRiskPolicy).toBe(appendRiskPolicy);
  });

  it('evolution is deterministic: the same appends fold the same chain', () => {
    const run = () => {
      let trail = unwrap(startRiskPolicyTrail(compileVersion(1), (T0 - 40_000) as never));
      trail = unwrap(appendRiskPolicy(trail, compileVersion(2), 'same reason', (T0 - 30_000) as never));
      trail = unwrap(appendRiskPolicy(trail, compileVersion(3), 'same reason again', (T0 - 20_000) as never));
      return trail;
    };
    const first = run();
    const second = run();
    expect(first).toEqual(second);
    expect(first.entries.map((entry) => entry.chainHead)).toEqual(second.entries.map((entry) => entry.chainHead));
  });
});

describe('appendRiskPolicy — the append-only laws', () => {
  function started() {
    return unwrap(startRiskPolicyTrail(compileVersion(1), (T0 - 40_000) as never));
  }

  it('a supersession without a reason fails (unauditable history)', () => {
    const result = appendRiskPolicy(started(), compileVersion(2), '', (T0 - 30_000) as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toBe('reason');
  });

  it('a policy from another scope fails (L12 — trails are tenant-isolated)', () => {
    const foreign = unwrap(compileRiskPolicy({
      constraintSet: { ...fixtureConstraintSet(), tenantId: 'tenant-beta' } as never,
      goal: GOAL,
      tenant: 'tenant-beta' as never,
      project: PROJECT as never,
      asOf: (T0 - 40_000) as never,
      ratioPrecision: 6,
    }));
    const result = appendRiskPolicy(started(), foreign, 'cross-tenant crime', (T0 - 30_000) as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('tenant_missing');
  });

  it('a version SKIP fails (versions chain contiguously)', () => {
    const result = appendRiskPolicy(started(), compileVersion(3), 'skip the middle', (T0 - 30_000) as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('policy_history_rewrite');
  });

  it('a FORKED supersedes pointer fails (the chain is contiguous or it is a rewrite)', () => {
    const trail = unwrap(appendRiskPolicy(started(), compileVersion(2), 'the real v2', (T0 - 30_000) as never));
    // Forge a version-3 policy whose supersedes pointer names version 1.
    const forkedSource = compileVersion(3);
    const forked = { ...forkedSource, supersedes: { policyId: compileVersion(1).policyId, version: 1 } } as typeof forkedSource;
    const result = appendRiskPolicy(trail, forked, 'fork the chain', (T0 - 20_000) as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('policy_history_rewrite');
  });

  it('re-appending the SAME version fails (one version, one entry)', () => {
    const trail = unwrap(appendRiskPolicy(started(), compileVersion(2), 'the real v2', (T0 - 30_000) as never));
    const result = appendRiskPolicy(trail, compileVersion(2), 'again', (T0 - 25_000) as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('policy_history_rewrite');
  });
});

describe('verifyRiskPolicyTrail — the rewrite trip wires', () => {
  function evolved() {
    let trail = unwrap(startRiskPolicyTrail(compileVersion(1), (T0 - 40_000) as never));
    trail = unwrap(appendRiskPolicy(trail, compileVersion(2), 'tighten drawdown', (T0 - 30_000) as never));
    trail = unwrap(appendRiskPolicy(trail, compileVersion(3), 'tighten again', (T0 - 20_000) as never));
    return trail;
  }

  it('the honest trail verifies green', () => {
    expect(verifyRiskPolicyTrail(evolved()).ok).toBe(true);
  });

  it('a SPLICED trail (a superseded version removed) fails with policy_history_rewrite', () => {
    const trail = evolved();
    const spliced = { ...trail, entries: [trail.entries[0] as never, trail.entries[2] as never] };
    const result = verifyRiskPolicyTrail(spliced);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('policy_history_rewrite');
  });

  it('an EDITED reason fails (the chain head no longer folds)', () => {
    const trail = evolved();
    const edited = {
      ...trail,
      entries: [trail.entries[0] as never, trail.entries[1] as never, { ...(trail.entries[2] as unknown as Record<string, unknown>), reason: 'rewritten history' } as never],
    };
    const result = verifyRiskPolicyTrail(edited);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('policy_history_rewrite');
  });

  it('a TRUNCATED trail fails (the chain folds from the genesis)', () => {
    const trail = evolved();
    const truncated = { ...trail, entries: [trail.entries[1] as never, trail.entries[2] as never] };
    const result = verifyRiskPolicyTrail(truncated);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('policy_history_rewrite');
  });

  it('a structurally invalid trail is rejected', () => {
    expect(verifyRiskPolicyTrail({ nonsense: true } as never).ok).toBe(false);
  });
});
