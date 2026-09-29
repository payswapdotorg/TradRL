/**
 * @tradrl/execution-policy — the CheckMachine tests: the pure gate's
 * behavioral laws.
 *
 * The SIX REFUSAL PATHS (the Work Order's acceptance criterion): for
 * each of identity / authorization / limits / venue permissions / rate
 * limits / kill switch, a fixture trips exactly that dimension and the
 * test asserts (a) the refusal names EXACTLY the failing check, (b)
 * the failing check's position in the DECLARED order, (c) the
 * structured reason carries the details (which limit, the cap, the
 * observed value, the excess), and (d) first-failure-wins over
 * multiple simultaneous failures. A seventh path (credentials) proves
 * the dimension's fail-closure beyond the required six.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CHECK_ORDER,
  isApproveDecision,
  isExecutionDecision,
  isRefusalDecision,
  restoreKillSwitch,
  runExecutionGate,
  startKillSwitch,
  throwKillSwitch,
  validateExecutionPolicy,
  type ExecutionPolicy,
  type RefusalDecision,
} from './index';
import { T0, fixtureIntent, fixtureKillSwitch, fixturePortfolio, fixturePolicyInput, fixtureVenueState, unwrap } from './test-fixtures';

/** Build the validated fixture policy. */
function policy(): ExecutionPolicy {
  return unwrap(validateExecutionPolicy(fixturePolicyInput()));
}

/** Run the gate over the fixture bundle with per-test overrides. */
function gate(options: {
  readonly intent?: Record<string, unknown>;
  readonly policy?: ExecutionPolicy;
  readonly venueState?: Record<string, unknown>;
  readonly killSwitch?: ReturnType<typeof fixtureKillSwitch>;
  readonly portfolio?: Record<string, unknown>;
}): ReturnType<typeof runExecutionGate> {
  return runExecutionGate({
    intent: fixtureIntent(options.intent),
    policy: options.policy ?? policy(),
    portfolio: fixturePortfolio(options.portfolio),
    venueState: fixtureVenueState(options.venueState),
    killSwitch: options.killSwitch ?? fixtureKillSwitch(),
  });
}

/** Unwrap a decision or fail loudly. */
function decision(options: Parameters<typeof gate>[0]) {
  const result = gate(options);
  if (!result.ok) throw new Error(`gate must decide: ${JSON.stringify(result.errors)}`);
  return result.value;
}

describe('CheckMachine — the approve path', () => {
  it('a fully-compliant intent approves with every check passed in the declared order', () => {
    const approved = decision({});
    expect(approved.kind).toBe('approve');
    expect(isApproveDecision(approved)).toBe(true);
    expect(approved.decisionId).toMatch(/^xd:[0-9a-f]{8}$/);
    expect(approved.checkOrder).toEqual(DEFAULT_CHECK_ORDER);
    expect(approved.checks).toHaveLength(DEFAULT_CHECK_ORDER.length);
    expect(approved.checks.every((check) => check.outcome === 'pass')).toBe(true);
    expect(approved.checks.map((check) => check.dimension)).toEqual(DEFAULT_CHECK_ORDER);
    // The lineage chain (L9): intent -> strategy -> goal, policy, venue, seed, tenant, project.
    expect(approved.lineage.intentRef).toBe('si:fixture0001');
    expect(approved.lineage.strategy).toEqual({ specId: 'spec-fixture', version: 1 });
    expect(approved.lineage.goal).toEqual({ goalId: 'goal-fixture', version: 1 });
    expect(approved.lineage.policy).toEqual({ policyId: policy().policyId, version: 1 });
    expect(approved.lineage.venues).toEqual(['REFSIM']);
    expect(approved.lineage.tenant).toBe('tenant-alpha');
    expect(approved.lineage.project).toBe('project-one');
    // The decision instant is the intent's asOf (no ambient clock).
    expect(approved.asOf).toBe(T0);
  });

  it('determinism: the same inputs produce the byte-identical decision, twice (L9)', () => {
    const first = decision({});
    const second = decision({});
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.decisionId).toBe(second.decisionId);
  });
});

describe('CheckMachine — the six refusal paths (first-failure-wins)', () => {
  /** Assert a refusal decision and narrow it. */
  function refusalOf(options: Parameters<typeof gate>[0]): RefusalDecision {
    const result = gate(options);
    if (!result.ok) throw new Error(`gate must decide: ${JSON.stringify(result.errors)}`);
    expect(result.value.kind).toBe('refuse');
    if (result.value.kind !== 'refuse') throw new Error('unreachable');
    expect(isRefusalDecision(result.value)).toBe(true);
    return result.value;
  }

  it('PATH 1 — identity fail: the refusal names identity at its declared position with expected/actual', () => {
    const refusal = refusalOf({ intent: { tenant: 'tenant-beta' as never } });
    expect(refusal.failure.dimension).toBe('identity');
    expect(refusal.failure.ordinal).toBe(DEFAULT_CHECK_ORDER.indexOf('identity') + 1);
    expect(refusal.failure.reason).toEqual({
      dimension: 'identity',
      subject: 'tenant',
      expected: 'tenant-alpha',
      actual: 'tenant-beta',
    });
    // First-failure-wins: the checks end at the identity failure.
    expect(refusal.checks.map((check) => check.dimension)).toEqual(['kill_switch', 'identity']);
    expect(refusal.checks[1]?.outcome).toBe('fail');
  });

  it('PATH 1b — identity fail by principal: an undeclared strategy is refused with expected/actual', () => {
    const refusal = refusalOf({ intent: { strategy: { specId: 'spec-intruder', version: 1 } } });
    expect(refusal.failure.dimension).toBe('identity');
    expect(refusal.failure.reason).toMatchObject({ subject: 'principal', actual: 'spec-intruder' });
  });

  it('PATH 2 — authorization fail: an unpermitted order kind is refused with the permitted kinds', () => {
    const refusal = refusalOf({
      intent: {
        order: {
          clientOrderId: 't019-fx-2',
          instrumentId: 'BTC-USD' as never,
          venueId: 'REFSIM' as never,
          side: 'sell',
          kind: 'stop',
          quantity: '0.5',
          stopPrice: '48000.00',
          timeInForce: 'gtc',
          createdAt: '2023-11-14T22:13:20.000Z',
        },
      },
    });
    expect(refusal.failure.dimension).toBe('authorization');
    expect(refusal.failure.ordinal).toBe(DEFAULT_CHECK_ORDER.indexOf('authorization') + 1);
    expect(refusal.failure.reason).toEqual({
      dimension: 'authorization',
      orderKind: 'stop',
      permittedKinds: ['limit', 'market'],
    });
    expect(refusal.checks.map((check) => check.dimension)).toEqual(['kill_switch', 'identity', 'authorization']);
  });

  it('PATH 3 — limits fail (order size): the refusal names the limit, the cap, the observed value and the excess', () => {
    // crypto class caps order size at 1; a 2.5 order breaches it by 1.5.
    const refusal = refusalOf({
      intent: { order: { ...fixtureIntent().order, quantity: '2.5' } },
    });
    expect(refusal.failure.dimension).toBe('limits');
    expect(refusal.failure.ordinal).toBe(DEFAULT_CHECK_ORDER.indexOf('limits') + 1);
    expect(refusal.failure.reason).toEqual({
      dimension: 'limits',
      limit: 'order_size',
      instrumentClass: 'crypto',
      cap: '1',
      observed: '2.5',
      excess: '1.5',
    });
    expect(refusal.checks.map((check) => check.dimension)).toEqual(['kill_switch', 'identity', 'authorization', 'limits']);
  });

  it('PATH 3b — limits fail (order notional): exact decimal product against the reference price', () => {
    // An equity-class instrument has no specific record, so the '*'
    // catch-all applies: order notional 0.5 x 70000 = 35000 breaches the
    // catch-all's 30000 cap by exactly 5000.
    const refusal = refusalOf({
      venueState: {
        asOf: T0,
        instruments: [{ venue: 'REFSIM' as never, instrument: 'BTC-USD' as never, instrumentClass: 'equity', referencePrice: '70000.00', rateWindowOrderCount: 0 }],
      },
    });
    expect(refusal.failure.dimension).toBe('limits');
    expect(refusal.failure.reason).toEqual({
      dimension: 'limits',
      limit: 'order_notional',
      instrumentClass: '*',
      cap: '30000',
      observed: '35000',
      excess: '5000',
    });
  });

  it('PATH 3c — limits fail (position size): the post-trade position breaches the cap', () => {
    const refusal = refusalOf({
      portfolio: {
        ...fixturePortfolio(),
        positions: [
          { instrumentId: 'BTC-USD' as never, venueId: 'REFSIM' as never, quantity: '1.6', costBasis: '80000', openedAt: (T0 - 500) as never },
        ],
      },
    });
    // Post-trade: 1.6 + 0.5 = 2.1 > maxPositionSize 2 (excess 0.1).
    expect(refusal.failure.reason).toEqual({
      dimension: 'limits',
      limit: 'position_size',
      instrumentClass: 'crypto',
      cap: '2',
      observed: '2.1',
      excess: '0.1',
    });
  });

  it('PATH 3d — limits fail (no record for the class): fail-closed, not best-effort', () => {
    // A policy with NO catch-all record: an 'exotic'-class instrument
    // finds no cap and the gate refuses rather than guessing.
    const noCatchAll = unwrap(validateExecutionPolicy({ ...fixturePolicyInput(), limits: [{ instrumentClass: 'crypto', maxOrderSize: '1', maxOrderNotional: '60000', maxPositionSize: '2', maxPositionNotional: '110000' }] }));
    const refusal = refusalOf({
      policy: noCatchAll,
      venueState: {
        asOf: T0,
        instruments: [{ venue: 'REFSIM' as never, instrument: 'BTC-USD' as never, instrumentClass: 'exotic', referencePrice: '50000.00', rateWindowOrderCount: 0 }],
      },
    });
    expect(refusal.failure.dimension).toBe('limits');
    if (refusal.failure.reason.dimension !== 'limits') throw new Error('unreachable');
    expect(refusal.failure.reason.cap).toBe('0');
    expect(refusal.failure.reason.observed).toBe('0.5');
  });

  it('PATH 4 — venue permissions fail: an unlisted (venue, instrument) pair is refused', () => {
    // ETH-USD is covered by the venue state but not allowlisted.
    const refusal = refusalOf({
      intent: {
        order: { ...fixtureIntent().order, instrumentId: 'ETH-USD' as never },
        rationale: { ...fixtureIntent().rationale, instrumentId: 'ETH-USD' },
      },
    });
    expect(refusal.failure.dimension).toBe('venue_permissions');
    expect(refusal.failure.ordinal).toBe(DEFAULT_CHECK_ORDER.indexOf('venue_permissions') + 1);
    expect(refusal.failure.reason).toEqual({
      dimension: 'venue_permissions',
      venue: 'REFSIM',
      instrument: 'ETH-USD',
    });
    expect(refusal.checks.map((check) => check.dimension)).toEqual([
      'kill_switch',
      'identity',
      'authorization',
      'limits',
      'venue_permissions',
    ]);
  });

  it('PATH 5 — rate limits fail: the projected submission exceeds the declared budget', () => {
    const refusal = refusalOf({
      venueState: {
        asOf: T0,
        instruments: [
          { venue: 'REFSIM' as never, instrument: 'BTC-USD' as never, instrumentClass: 'crypto', referencePrice: '50000.00', rateWindowOrderCount: 10 },
          { venue: 'REFSIM' as never, instrument: 'ETH-USD' as never, instrumentClass: 'crypto', referencePrice: '3000.00', rateWindowOrderCount: 10 },
        ],
      },
    });
    expect(refusal.failure.dimension).toBe('rate_limits');
    expect(refusal.failure.ordinal).toBe(DEFAULT_CHECK_ORDER.indexOf('rate_limits') + 1);
    expect(refusal.failure.reason).toEqual({
      dimension: 'rate_limits',
      venue: 'REFSIM',
      windowMs: 60_000,
      budget: 10,
      observed: 10,
    });
    expect(refusal.checks.map((check) => check.dimension)).toEqual([
      'kill_switch',
      'identity',
      'authorization',
      'limits',
      'venue_permissions',
      'rate_limits',
    ]);
  });

  it('PATH 5b — rate limits fail-closed when no budget is declared for the venue', () => {
    const noBudget = unwrap(validateExecutionPolicy({ ...fixturePolicyInput(), rateLimits: [] }));
    const refusal = refusalOf({ policy: noBudget });
    expect(refusal.failure.dimension).toBe('rate_limits');
    expect(refusal.failure.reason).toEqual({
      dimension: 'rate_limits',
      venue: 'REFSIM',
      windowMs: null,
      budget: 0,
      observed: 0,
    });
  });

  it('PATH 6 — kill switch fail: once thrown, EVERY intent is refused with the kill-switch kind', () => {
    const thrown = unwrap(throwKillSwitch(fixtureKillSwitch(), 'circuit breaker: adverse market conditions', (T0 + 1_000) as never));
    // A fully-compliant intent (the approve fixture) still refuses.
    const refusal = refusalOf({ killSwitch: thrown });
    expect(refusal.failure.dimension).toBe('kill_switch');
    expect(refusal.failure.ordinal).toBe(1);
    expect(refusal.failure.reason).toEqual({
      dimension: 'kill_switch',
      switchId: thrown.switchId,
      thrownAt: T0 + 1_000,
      reason: 'circuit breaker: adverse market conditions',
    });
    // The kill switch is FIRST: no other check even ran.
    expect(refusal.checks).toHaveLength(1);
    expect(refusal.checks[0]).toEqual({ dimension: 'kill_switch', ordinal: 1, outcome: 'fail' });
    // And after a restore, the same intent approves again.
    const restored = unwrap(restoreKillSwitch(thrown, (T0 + 2_000) as never));
    const again = decision({ killSwitch: restored });
    expect(again.kind).toBe('approve');
  });

  it('PATH 7 (beyond the required six) — credentials fail: a venue without a credential binding is refused', () => {
    const noBindings = unwrap(validateExecutionPolicy({ ...fixturePolicyInput(), credentials: [] }));
    const refusal = refusalOf({ policy: noBindings });
    expect(refusal.failure.dimension).toBe('credentials');
    expect(refusal.failure.ordinal).toBe(DEFAULT_CHECK_ORDER.indexOf('credentials') + 1);
    expect(refusal.failure.reason).toEqual({ dimension: 'credentials', venue: 'REFSIM' });
    expect(refusal.checks.map((check) => check.dimension)).toEqual([...DEFAULT_CHECK_ORDER]);
  });

  it('first-failure-wins: multiple simultaneous failures produce ONLY the earliest refusal', () => {
    // Wrong tenant AND unpermitted kind AND over-size AND wrong venue:
    // identity (ordinal 2) must win.
    const refusal = refusalOf({
      intent: {
        tenant: 'tenant-beta' as never,
        order: {
          clientOrderId: 't019-fx-3',
          instrumentId: 'ETH-USD' as never,
          venueId: 'REFSIM' as never,
          side: 'buy',
          kind: 'stop',
          quantity: '99',
          stopPrice: '2900.00',
          timeInForce: 'gtc',
          createdAt: '2023-11-14T22:13:20.000Z',
        },
        rationale: { ...fixtureIntent().rationale, instrumentId: 'ETH-USD' },
      },
    });
    expect(refusal.failure.dimension).toBe('identity');
    expect(refusal.checks.filter((check) => check.outcome === 'fail')).toHaveLength(1);
  });

  it('the declared order is honored: a reordered policy fails at the reordered position', () => {
    const reordered = ['kill_switch', 'venue_permissions', 'identity', 'authorization', 'limits', 'rate_limits', 'credentials'] as const;
    const reorderedPolicy = unwrap(validateExecutionPolicy({ ...fixturePolicyInput(), checkOrder: reordered }));
    // ETH-USD fails venue_permissions at ordinal 2 (not 5).
    const refusal = refusalOf({
      policy: reorderedPolicy,
      intent: {
        order: { ...fixtureIntent().order, instrumentId: 'ETH-USD' as never },
        rationale: { ...fixtureIntent().rationale, instrumentId: 'ETH-USD' },
      },
    });
    expect(refusal.failure.dimension).toBe('venue_permissions');
    expect(refusal.failure.ordinal).toBe(2);
  });
});

describe('CheckMachine — envelope failures (never check refusals)', () => {
  it('NEGATIVE — a malformed intent is an operation error, never a decision', () => {
    const result = runExecutionGate({
      intent: { bad: 'shape' },
      policy: policy(),
      portfolio: fixturePortfolio(),
      venueState: fixtureVenueState(),
      killSwitch: fixtureKillSwitch(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_type');
  });

  it('NEGATIVE — a venue state that does not cover the intent\'s pair fails with venue_state_gap', () => {
    const result = gate({
      intent: { order: { ...fixtureIntent().order, instrumentId: 'SOL-USD' as never } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('venue_state_gap');
  });

  it('NEGATIVE — a tampered kill-switch log fails with killswitch_rewrite (the gate refuses to read it)', () => {
    const standing = fixtureKillSwitch();
    const forged = JSON.parse(JSON.stringify(standing)) as { records: { asOf: number }[] };
    forged.records[0] = { ...forged.records[0], asOf: forged.records[0].asOf + 1 }; // edit the genesis — the crime
    const result = gate({ killSwitch: forged as never });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('killswitch_rewrite');
  });

  it('NEGATIVE — a switch log that is not the policy\'s declared switch fails with switch_binding_mismatch', () => {
    const otherSwitch = unwrap(startKillSwitch('tenant-alpha' as never, 'project-one' as never, (T0 - 999) as never));
    const result = gate({ killSwitch: otherSwitch });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('switch_binding_mismatch');
  });

  it('every decision is deeply frozen and guard-valid', () => {
    const approved = decision({});
    expect(isExecutionDecision(approved)).toBe(true);
    expect(Object.isFrozen(approved)).toBe(true);
    expect(Object.isFrozen(approved.checks)).toBe(true);
    expect(Object.isFrozen(approved.lineage)).toBe(true);
  });
});
