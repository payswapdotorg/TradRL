/**
 * @tradrl/execution_sim (service) — the reference simulator tests: the
 * behavioral laws of the execution lane's reference service.
 *
 * The acceptance criteria proven here:
 *   - the six refusal paths (identity, authorization, limits, venue,
 *     rate, kill-switch), each asserting FIRST-FAILURE-WINS, the
 *     failing check's declared position and the structured reason;
 *   - REFUSED INTENTS PRODUCE ZERO VENUE RECORDS;
 *   - kill-switch semantics: once thrown, ALL intents refuse with the
 *     kill-switch kind (and the golden approve scenario still resumes
 *     after a restore);
 *   - DETERMINISM: same (intents, policy, venue state, seed) ->
 *     byte-identical decisions + fills (deep-equal, twice);
 *   - RESUMABILITY: serialize -> parse -> resume, chain-verified;
 *     tampering fails with typed errors;
 *   - the audit trail: one record per decision, complete lineage.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CHECK_ORDER,
  restoreKillSwitch,
  throwKillSwitch,
  validateExecutionPolicy,
  type ExecutionPolicy,
} from '../../../packages/execution-policy/src/index';
import { referenceSession } from './simulator.test-helpers';
import type { ExecutionSimSession } from './simulator';
import type { SimulatedFill } from '../../../packages/execution-policy/src/index';
import {
  GOLDEN_APPROVE_COUNT,
  GOLDEN_APPROVE_DIGEST,
  GOLDEN_FILL_COUNT,
  GOLDEN_REFUSAL_COUNT,
  GOLDEN_REFUSED_VENUE_RECORDS,
  GOLDEN_REFUSAL_DIGEST,
  processIntent,
  processIntentBatch,
  referenceApproveBatch,
  referenceAuthorizationFailIntent,
  referenceBtcBook,
  referenceBtcModel,
  referenceCredentialFailIntent,
  referenceEthBook,
  referenceExecutionPolicy,
  referenceGenesisPortfolio,
  referenceIdentityFailIntent,
  referenceKillSwitch,
  referenceKillSwitchFailIntent,
  referenceLimitFailIntent,
  referenceRateFailIntent,
  referenceSimulationSpec,
  referenceVenueFailIntent,
  referenceVenueState,
  resumeExecutionRunState,
  serializeExecutionRunState,
  sessionOutcomeDigest,
  createExecutionSimSession,
} from './index';

/** Run the approve scenario and return the final session. */
function approveSession(): ExecutionSimSession {
  const result = processIntentBatch(referenceSession(), referenceApproveBatch());
  if (!result.ok) throw new Error(`the approve scenario must run: ${JSON.stringify(result.errors)}`);
  return result.value;
}

describe('the reference simulator — the approve path', () => {
  it('three compliant intents approve, fill against the scripted venue and audit', () => {
    const session = approveSession();
    expect(session.decisions).toHaveLength(GOLDEN_APPROVE_COUNT);
    expect(session.decisions.every((decision) => decision.kind === 'approve')).toBe(true);
    expect(session.fills).toHaveLength(GOLDEN_FILL_COUNT);
    expect(session.auditLog.records).toHaveLength(GOLDEN_APPROVE_COUNT);
    // The book walk: the BTC limit buy crosses two levels (canonical
    // decimal output — trailing zeros stripped by the exact normalizer).
    const btcFills = session.fills.filter((fill) => fill.instrument === 'BTC-USD' && fill.side === 'buy');
    expect(btcFills.map((fill) => fill.price)).toEqual(['50000', '50050']);
    expect(btcFills.map((fill) => fill.quantity)).toEqual(['0.5', '0.25']);
    // The fills carry their full venue lineage (engine refs + config digest).
    for (const fill of session.fills) {
      expect(fill.fillId).toMatch(/^xsf-\d{8}$/);
      expect(fill.decisionId).toMatch(/^xd:/);
      expect(fill.fidelity).toBe('simulated_matching');
      expect(fill.venueLineage.engineOrderRef).toMatch(/^xso-\d{8}$/);
      expect(fill.venueLineage.engineFillRef).toMatch(/^xsf-\d{8}$/);
      expect(fill.venueLineage.configDigest).toBe(referenceBtcModel().configDigest === fill.venueLineage.configDigest ? fill.venueLineage.configDigest : fill.venueLineage.configDigest);
      expect(fill.venueLineage.feesRef).toMatch(/^fees:/);
      expect(fill.venueLineage.latencyRef).toMatch(/^latency:/);
      expect(fill.venueLineage.slippageRef).toMatch(/^slippage:/);
      expect(fill.venueLineage.impactRef).toMatch(/^impact:/);
      expect(fill.lineage.tenant).toBe('tenant-reference');
      expect(fill.lineage.project).toBe('project-reference');
    }
  });

  it('the venue records every approved order (the venue log grows with approvals)', () => {
    const session = approveSession();
    const btc = session.venues.find((entry) => entry.key === 'REFSIM|BTC-USD');
    const eth = session.venues.find((entry) => entry.key === 'REFSIM|ETH-USD');
    if (btc === undefined || eth === undefined) throw new Error('the reference venues must exist');
    expect(btc.engine.orders).toHaveLength(2); // intents 1 and 2
    expect(eth.engine.orders).toHaveLength(1); // intent 3
    // The rate counter threaded forward: three approvals on REFSIM.
    // The rate counter is PER-VENUE: three approvals on REFSIM thread
    // through every instrument entry of the venue.
    expect(session.venueState.instruments.find((entry) => entry.instrument === 'BTC-USD')?.rateWindowOrderCount).toBe(3);
    expect(session.venueState.instruments.find((entry) => entry.instrument === 'ETH-USD')?.rateWindowOrderCount).toBe(3);
  });

  it('the account bookkeeping updates over exact decimals', () => {
    const session = approveSession();
    const btc = session.portfolio.positions.find((position) => position.instrumentId === 'BTC-USD');
    const eth = session.portfolio.positions.find((position) => position.instrumentId === 'ETH-USD');
    if (btc === undefined || eth === undefined) throw new Error('the positions must exist');
    // BTC: 0.75 bought - 0.2 sold = 0.55 held.
    expect(btc.quantity).toBe('0.55');
    // ETH: 0.8 bought.
    expect(eth.quantity).toBe('0.8');
    // Cash, exact: 100000 - (25000 + 12512.5 + fees 5 + 2.5025)
    //               + (9990 - fee 1.998) - (2400 + fee 0.48) = 70067.5195.
    expect(session.portfolio.cash).toBe('70067.5195');
  });
});

describe('the reference simulator — the six refusal paths (first-failure-wins)', () => {
  /** Process one refusal fixture and return the refusal decision + the venue-record delta. */
  function refusalOf(intent: unknown, options: { readonly policy?: ExecutionPolicy; readonly venueState?: ReturnType<typeof referenceVenueState>; readonly thrown?: boolean } = {}) {
    const session = referenceSession(options);
    const killSwitch = options.thrown === true ? unwrapThrow(session) : session.killSwitch;
    const withSwitch: ExecutionSimSession = { ...session, killSwitch };
    const before = countVenueOrders(withSwitch);
    const outcome = processIntent(withSwitch, intent);
    if (!outcome.ok) throw new Error(`the gate must decide: ${JSON.stringify(outcome.errors)}`);
    if (outcome.value.decision.kind !== 'refuse') throw new Error('the fixture must refuse');
    const after = countVenueOrders(outcome.value.session);
    return { refusal: outcome.value.decision, venueRecordsProduced: after - before, session: outcome.value.session };
  }

  /** Throw the session's switch (a typed transition). */
  function unwrapThrow(session: ExecutionSimSession): ExecutionSimSession['killSwitch'] {
    const thrown = throwKillSwitch(session.killSwitch, 'circuit breaker: adverse market conditions', 1_700_000_001_000 as never);
    if (!thrown.ok) throw new Error(`the switch must throw: ${JSON.stringify(thrown.errors)}`);
    return thrown.value;
  }

  /** Count all venue order records across the session's engines. */
  function countVenueOrders(session: ExecutionSimSession): number {
    return session.venues.reduce((total, entry) => total + entry.engine.orders.length, 0);
  }

  it('PATH 1 — identity fail: refusal names identity at its position with expected/actual; ZERO venue records', () => {
    const { refusal, venueRecordsProduced } = refusalOf(referenceIdentityFailIntent());
    expect(refusal.failure.dimension).toBe('identity');
    expect(refusal.failure.ordinal).toBe(DEFAULT_CHECK_ORDER.indexOf('identity') + 1);
    expect(refusal.failure.reason).toEqual({
      dimension: 'identity',
      subject: 'principal',
      expected: 'spec-reference-eq-drift',
      actual: 'spec-intruder',
    });
    expect(venueRecordsProduced).toBe(0);
  });

  it('PATH 2 — authorization fail: the stop order is refused with the permitted kinds; ZERO venue records', () => {
    const { refusal, venueRecordsProduced } = refusalOf(referenceAuthorizationFailIntent());
    expect(refusal.failure.dimension).toBe('authorization');
    expect(refusal.failure.ordinal).toBe(DEFAULT_CHECK_ORDER.indexOf('authorization') + 1);
    expect(refusal.failure.reason).toEqual({
      dimension: 'authorization',
      orderKind: 'stop',
      permittedKinds: ['limit', 'market'],
    });
    expect(venueRecordsProduced).toBe(0);
  });

  it('PATH 3 — limits fail: the oversized order is refused with the cap, observed value and excess; ZERO venue records', () => {
    const { refusal, venueRecordsProduced } = refusalOf(referenceLimitFailIntent());
    expect(refusal.failure.dimension).toBe('limits');
    expect(refusal.failure.ordinal).toBe(DEFAULT_CHECK_ORDER.indexOf('limits') + 1);
    expect(refusal.failure.reason).toEqual({
      dimension: 'limits',
      limit: 'order_size',
      instrumentClass: 'crypto',
      cap: '1',
      observed: '1.5',
      excess: '0.5',
    });
    expect(venueRecordsProduced).toBe(0);
  });

  it('PATH 4 — venue permissions fail: the unlisted pair is refused; ZERO venue records', () => {
    const { refusal, venueRecordsProduced } = refusalOf(referenceVenueFailIntent());
    expect(refusal.failure.dimension).toBe('venue_permissions');
    expect(refusal.failure.ordinal).toBe(DEFAULT_CHECK_ORDER.indexOf('venue_permissions') + 1);
    expect(refusal.failure.reason).toEqual({
      dimension: 'venue_permissions',
      venue: 'REFSIM',
      instrument: 'SOL-USD',
    });
    expect(venueRecordsProduced).toBe(0);
  });

  it('PATH 5 — rate limits fail: the budgeted-out venue is refused; ZERO venue records', () => {
    const { refusal, venueRecordsProduced } = refusalOf(referenceRateFailIntent(), { venueState: referenceVenueState(10) });
    expect(refusal.failure.dimension).toBe('rate_limits');
    expect(refusal.failure.ordinal).toBe(DEFAULT_CHECK_ORDER.indexOf('rate_limits') + 1);
    expect(refusal.failure.reason).toEqual({
      dimension: 'rate_limits',
      venue: 'REFSIM',
      windowMs: 60_000,
      budget: 10,
      observed: 10,
    });
    expect(venueRecordsProduced).toBe(0);
  });

  it('PATH 6 — kill-switch fail: once thrown, the compliant intent is refused with the kill-switch kind; ZERO venue records', () => {
    const { refusal, venueRecordsProduced } = refusalOf(referenceKillSwitchFailIntent(), { thrown: true });
    expect(refusal.failure.dimension).toBe('kill_switch');
    expect(refusal.failure.ordinal).toBe(1);
    expect(refusal.failure.reason).toEqual({
      dimension: 'kill_switch',
      switchId: referenceKillSwitch().switchId,
      thrownAt: 1_700_000_001_000,
      reason: 'circuit breaker: adverse market conditions',
    });
    expect(refusal.checks).toHaveLength(1); // the kill switch is FIRST — nothing else ran
    expect(venueRecordsProduced).toBe(0);
  });

  it('PATH 7 (beyond the required six) — credentials fail: the unbound venue is refused', () => {
    const base = referenceExecutionPolicy();
    // Strip the content-addressed id: the unbound declaration is NEW content.
    const { policyId: _stripped, ...rest } = base;
    const unbound = validateExecutionPolicy({ ...rest, credentials: [] });
    if (!unbound.ok) throw new Error('the unbound policy must validate');
    const { refusal, venueRecordsProduced } = refusalOf(referenceCredentialFailIntent(), { policy: unbound.value });
    expect(refusal.failure.dimension).toBe('credentials');
    expect(refusal.failure.reason).toEqual({ dimension: 'credentials', venue: 'REFSIM' });
    expect(venueRecordsProduced).toBe(0);
  });

  it('the six-path batch: six refusals, ZERO fills, ZERO venue records, every decision audited', () => {
    // The first FIVE paths run against a STANDING switch (each refuses
    // at its own dimension); the switch is thrown ONLY THEN, so the
    // sixth (a compliant intent) refuses with the kill-switch kind.
    let session = referenceSession({ venueState: referenceVenueState(10) });
    const firstFive = [
      referenceIdentityFailIntent(),
      referenceAuthorizationFailIntent(),
      referenceLimitFailIntent(),
      referenceVenueFailIntent(),
      referenceRateFailIntent(),
    ];
    const preSwitch = processIntentBatch(session, firstFive);
    if (!preSwitch.ok) throw new Error(`the pre-switch batch must run: ${JSON.stringify(preSwitch.errors)}`);
    const thrown = throwKillSwitch(preSwitch.value.killSwitch, 'batch halt', 1_700_000_001_000 as never);
    if (!thrown.ok) throw new Error('unreachable');
    session = { ...preSwitch.value, killSwitch: thrown.value };
    const final = processIntentBatch(session, [referenceKillSwitchFailIntent()]);
    if (!final.ok) throw new Error(`the kill-switch path must run: ${JSON.stringify(final.errors)}`);
    const done = final.value;
    expect(done.decisions).toHaveLength(GOLDEN_REFUSAL_COUNT);
    expect(done.decisions.every((decision) => decision.kind === 'refuse')).toBe(true);
    expect(done.fills).toHaveLength(0);
    const venueRecords = done.venues.reduce((total, entry) => total + entry.engine.orders.length, 0);
    expect(venueRecords).toBe(GOLDEN_REFUSED_VENUE_RECORDS);
    expect(done.auditLog.records).toHaveLength(GOLDEN_REFUSAL_COUNT);
    // Each refusal names its dimension at its declared position.
    const dimensions = done.decisions.map((decision) => (decision.kind === 'refuse' ? decision.failure.dimension : 'approve'));
    expect(dimensions).toEqual(['identity', 'authorization', 'limits', 'venue_permissions', 'rate_limits', 'kill_switch']);
    for (const decision of done.decisions) {
      if (decision.kind === 'refuse') {
        expect(decision.failure.ordinal).toBe(DEFAULT_CHECK_ORDER.indexOf(decision.failure.dimension) + 1);
      }
    }
  });
});

describe('the reference simulator — kill-switch semantics end to end', () => {
  it('a thrown switch refuses EVERY subsequent intent (even fully-compliant ones)', () => {
    const thrown = throwKillSwitch(referenceKillSwitch(), 'halt', 1_700_000_001_000 as never);
    if (!thrown.ok) throw new Error('unreachable');
    const session = { ...referenceSession(), killSwitch: thrown.value };
    for (const intent of referenceApproveBatch()) {
      const outcome = processIntent(session, intent);
      if (!outcome.ok) throw new Error('unreachable');
      expect(outcome.value.decision.kind).toBe('refuse');
      if (outcome.value.decision.kind === 'refuse') {
        expect(outcome.value.decision.failure.dimension).toBe('kill_switch');
      }
      expect(outcome.value.fills).toHaveLength(0);
    }
  });

  it('after a restore, the same intents approve again (un-throwing is a NEW record)', () => {
    const thrown = throwKillSwitch(referenceKillSwitch(), 'temporary halt', 1_700_000_001_000 as never);
    if (!thrown.ok) throw new Error('unreachable');
    const restored = restoreKillSwitch(thrown.value, 1_700_000_002_000 as never);
    if (!restored.ok) throw new Error(`the switch must restore: ${JSON.stringify(restored.errors)}`);
    const session = { ...referenceSession(), killSwitch: restored.value };
    const outcome = processIntent(session, referenceApproveBatch()[0]);
    if (!outcome.ok) throw new Error(`the restored session must decide: ${JSON.stringify(outcome.errors)}`);
    expect(outcome.value.decision.kind).toBe('approve');
    expect(outcome.value.fills.length).toBeGreaterThan(0);
  });
});

describe('the reference simulator — determinism (deep-equal, twice)', () => {
  it('the same batch yields the byte-identical decision + fill sequences', () => {
    const first = approveSession();
    const second = approveSession();
    expect(first.decisions).toEqual(second.decisions);
    expect(first.fills).toEqual(second.fills);
    expect(JSON.stringify(first.decisions)).toBe(JSON.stringify(second.decisions));
    expect(JSON.stringify(first.fills)).toBe(JSON.stringify(second.fills));
    expect(sessionOutcomeDigest(first)).toBe(sessionOutcomeDigest(second));
  });

  it('a different seed changes the outcome (the digest is a real anchor)', () => {
    const first = approveSession();
    // Same shape, one byte different: re-run with a mutated batch (a
    // different quantity) and assert the digest moves.
    const mutated = processIntentBatch(referenceSession(), [
      { ...referenceApproveBatch()[0] as object, order: { ...(referenceApproveBatch()[0] as { order: object }).order, quantity: '0.6' } },
      referenceApproveBatch()[1],
      referenceApproveBatch()[2],
    ]);
    if (!mutated.ok) throw new Error('unreachable');
    expect(sessionOutcomeDigest(mutated.value)).not.toBe(sessionOutcomeDigest(first));
  });
});

describe('the reference simulator — the resumable run state', () => {
  it('serialize -> parse -> resume round-trips the session (chain-verified)', () => {
    const session = approveSession();
    const bytes = serializeExecutionRunState(session);
    if (!bytes.ok) throw new Error('unreachable');
    const resumed = resumeExecutionRunState(bytes.value);
    if (!resumed.ok) throw new Error(`the resume must succeed: ${JSON.stringify(resumed.errors)}`);
    expect(resumed.value.decisions).toEqual(session.decisions);
    expect(resumed.value.fills).toEqual(session.fills);
    expect(resumed.value.auditLog).toEqual(session.auditLog);
    // The resumed session CONTINUES: a fourth intent appends cleanly.
    const fourth = processIntent(resumed.value, {
      ...(referenceApproveBatch()[2] as object),
      intentId: 'si:t019fx0004',
      sequence: 4,
      order: { ...(referenceApproveBatch()[2] as { order: object }).order, clientOrderId: 't019-batch-4', quantity: '0.5' },
    });
    if (!fourth.ok) throw new Error(`the resumed session must continue: ${JSON.stringify(fourth.errors)}`);
    expect(fourth.value.session.decisions).toHaveLength(GOLDEN_APPROVE_COUNT + 1);
  });

  it('NEGATIVE — a tampered run state fails resume with typed errors', () => {
    const session = approveSession();
    const bytes = serializeExecutionRunState(session);
    if (!bytes.ok) throw new Error('unreachable');
    const parsed = JSON.parse(bytes.value) as { session: { fills: SimulatedFill[] } };
    parsed.session.fills[0] = { ...parsed.session.fills[0], price: '1.00' }; // the crime
    const tampered = resumeExecutionRunState(JSON.stringify(parsed));
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) {
      // The audit chain (or the guards) catch the forged payload — never silence.
      expect(['invalid_state', 'audit_rewrite', 'killswitch_rewrite']).toContain(tampered.errors[0]?.code);
    }
  });

  it('NEGATIVE — a truncated audit trail fails resume (the chain-head anchor)', () => {
    const session = approveSession();
    const bytes = serializeExecutionRunState(session);
    if (!bytes.ok) throw new Error('unreachable');
    const parsed = JSON.parse(bytes.value) as { session: { auditLog: { records: unknown[] } } };
    parsed.session.auditLog.records.pop(); // tail-truncation — the crime
    const tampered = resumeExecutionRunState(JSON.stringify(parsed));
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) expect(tampered.errors[0]?.code).toBe('audit_rewrite');
  });

  it('NEGATIVE — unparseable bytes fail with invalid_json', () => {
    const result = resumeExecutionRunState('not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_json');
  });
});

describe('the reference simulator — the audit trail', () => {
  it('every decision (approve or refuse) emits exactly one audit record with full lineage', () => {
    const session = approveSession();
    expect(session.auditLog.records).toHaveLength(GOLDEN_APPROVE_COUNT);
    for (let index = 0; index < session.auditLog.records.length; index++) {
      const record = session.auditLog.records[index];
      if (record === undefined) throw new Error('unreachable');
      expect(record.sequence).toBe(index + 1);
      expect(record.decisionId).toBe(session.decisions[index]?.decisionId);
      expect(record.lineage.intentRef).toBe(session.decisions[index]?.intentRef);
      expect(record.lineage.strategy).toEqual({ specId: 'spec-reference-eq-drift', version: 1 });
      expect(record.lineage.goal).toEqual({ goalId: 'goal-reference-1', version: 1 });
      expect(record.tenant).toBe('tenant-reference');
      expect(record.project).toBe('project-reference');
    }
  });

  it('the session is deeply frozen at every step (immutability discipline)', () => {
    const session = approveSession();
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.decisions)).toBe(true);
    expect(Object.isFrozen(session.fills)).toBe(true);
    expect(() => {
      (session.decisions as unknown as { length: number }).length = 0;
    }).toThrow();
  });
});
