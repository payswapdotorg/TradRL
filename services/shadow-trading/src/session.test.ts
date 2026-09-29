/**
 * The shadow session's behavioral suite: the enforcement order (the
 * existential law), refusal-before-fill for EVERY refusal kind, the
 * kill-switch dominance, the L12 envelope, mode honesty, the
 * append-only outcome log, the fork, and the golden scenario's exact
 * facts (all hand-derived in fixtures.ts's header).
 */

import { describe, expect, it } from 'vitest';
import {
  unwrapMachine,
  createReferenceSession,
  referenceIntentStream,
  identityFailIntent,
  authorizationFailIntent,
  limitFailIntent,
  venueFailIntent,
  rateFailIntent,
  credentialFailIntent,
  compliantIntent,
  crossTenantIntent,
  referenceExecutionPolicy,
  referenceVenueState,
  unwrap,
  T0,
  decisionSourceOf,
  runReferenceScenario,
  createScriptedWorld,
  createScriptedMachine,
} from './fixtures';
import { createShadowSession, forkShadowSession, processShadowDecision, throwShadowKillSwitch, runShadowSession } from './session';
import { appendShadowOutcome, mintShadowOutcomeRecord, startShadowOutcomeLog } from './outcomes';
import { shadowOutcomeDigest } from './outcomes';
import { GOLDEN_DISPOSITIONS, GOLDEN_SUBMISSION_COUNT, GOLDEN_FILL_COUNT, GOLDEN_REFUSAL_COUNT, GOLDEN_FINAL_BOOK, GOLDEN_OUTCOME_DIGEST } from './golden';
import { fail } from './errors';

// ---------------------------------------------------------------------------
// The enforcement order (the existential law of this lane)
// ---------------------------------------------------------------------------

describe('the enforcement order — the FULL control stack BEFORE any submission', () => {
  it('the golden scenario: 6 submissions, 1 risk-stage refusal, zero fills for the refusal', async () => {
    const session = await runReferenceScenario();
    expect(session.submissions.length).toBe(GOLDEN_SUBMISSION_COUNT);
    expect(session.fills.length).toBe(GOLDEN_FILL_COUNT);
    expect(session.refusals.length).toBe(GOLDEN_REFUSAL_COUNT);
    // The risk-stage refusal produced ZERO fills (d4's fills are empty).
    const refused = session.outcomeLog.records.find((record) => record.disposition === 'refused');
    expect(refused).toBeDefined();
    expect(refused?.fills.length).toBe(0);
    // Every fill belongs to an APPROVED decision.
    const approvedIds = new Set(session.decisions.filter((decision) => decision.kind === 'approve').map((decision) => decision.decisionId as string));
    for (const fill of session.fills) {
      expect(approvedIds.has(fill.decisionId)).toBe(true);
    }
  });

  it('the risk-stage refusal: the gate APPROVED, the risk evaluation refused, the world received nothing', () => {
    const session = unwrap(createReferenceSession({ intents: [] }));
    const d1 = unwrap(processShadowDecision(session, referenceIntentStream()[0]!));
    const d2 = unwrap(processShadowDecision(d1.session, referenceIntentStream()[1]!));
    const d3 = unwrap(processShadowDecision(d2.session, referenceIntentStream()[2]!));
    const d4 = unwrap(processShadowDecision(d3.session, referenceIntentStream()[3]!));
    // The GATE approved d4 (the refusal came from the risk stage)...
    expect(d4.decision.kind).toBe('approve');
    expect(d4.refusal).not.toBeNull();
    expect(d4.refusal?.stage).toBe('risk');
    // ...the risk evaluation carries the breaching limit states...
    expect(d4.refusal?.limitRefusals.length).toBeGreaterThan(0);
    const breach = d4.refusal?.limitRefusals[0] as { limit: string; instrumentClass: string; cap: string; observed: string; excess: string };
    expect(breach.limit).toBe('position_notional');
    expect(breach.instrumentClass).toBe('crypto');
    expect(breach.cap).toBe('52000');
    expect(breach.observed).toBe('52250'); // 0.55 BTC x the 95000 mark — hand-derived
    expect(breach.excess).toBe('250');
    // ...and the WORLD RECEIVED NOTHING: zero submissions, zero fills for this decision.
    expect(d4.session.submissions.length).toBe(3);
    expect(d4.fills.length).toBe(0);
    const d4Outcome = d4.outcome;
    expect(d4Outcome.disposition).toBe('refused');
    expect(d4Outcome.fills.length).toBe(0);
    expect(d4Outcome.refusalRef).toBe(d4.refusal?.refusalId);
  });

  it('both stages run for every decision: the refusal record carries the gate decision AND the limit evaluation', () => {
    const session = unwrap(createReferenceSession({ intents: [identityFailIntent()] }));
    const outcome = unwrap(processShadowDecision(session, identityFailIntent()));
    expect(outcome.refusal).not.toBeNull();
    expect(outcome.refusal?.stage).toBe('gate');
    // The composite record: the T019 decision + the T020 limit states.
    expect((outcome.refusal?.gate as { kind: string }).kind).toBe('refuse');
    expect(outcome.refusal?.risk).not.toBeNull();
    expect(Array.isArray((outcome.refusal?.risk as { states: unknown[] }).states)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Refusal-before-fill for EVERY refusal kind (zero world submissions each)
// ---------------------------------------------------------------------------

describe('refusal-before-fill — every gate dimension refuses with ZERO world submissions', () => {
  /** Drive one refusal-kind intent through a fresh session and assert the zero-submission law. */
  function assertRefusalKind(
    label: string,
    intent: unknown,
    expectedDimension: string,
    options: { readonly venueState?: ReturnType<typeof referenceVenueState>; readonly policy?: ReturnType<typeof referenceExecutionPolicy> } = {},
  ): void {
    it(`${label} — refuses at ${expectedDimension} with zero submissions and zero fills`, () => {
      const session = unwrap(createReferenceSession({ intents: [], venueState: options.venueState, executionPolicy: options.policy }));
      const outcome = unwrap(processShadowDecision(session, intent));
      expect(outcome.decision.kind).toBe('refuse');
      expect(outcome.refusal?.stage).toBe('gate');
      const failure = (outcome.decision as { failure: { dimension: string; reason: Record<string, unknown> } }).failure;
      expect(failure.dimension).toBe(expectedDimension);
      expect(outcome.session.submissions.length).toBe(0);
      expect(outcome.session.fills.length).toBe(0);
      expect(outcome.fills.length).toBe(0);
      expect(outcome.outcome.disposition).toBe('refused');
      expect(outcome.outcome.fills.length).toBe(0);
    });
  }

  assertRefusalKind('identity fail (undeclared principal)', identityFailIntent(), 'identity');
  assertRefusalKind('authorization fail (stop order)', authorizationFailIntent(), 'authorization');
  assertRefusalKind('limits fail (order size over the cap)', limitFailIntent(), 'limits');
  assertRefusalKind('venue permissions fail (SOL-USD)', venueFailIntent(), 'venue_permissions');
  assertRefusalKind('rate limits fail (window at budget)', rateFailIntent(), 'rate_limits', { venueState: referenceVenueState(10) });
  assertRefusalKind('credentials fail (no binding)', credentialFailIntent(), 'credentials', { policy: referenceExecutionPolicy({ omitCredentials: true }) });

  it('a duplicate intent is the typed invalid_state (one intent, one decision)', () => {
    const session = unwrap(createReferenceSession({ intents: [] }));
    const first = unwrap(processShadowDecision(session, compliantIntent()));
    const second = processShadowDecision(first.session, compliantIntent());
    expect(second.ok).toBe(false);
    expect(!second.ok && second.errors[0]?.code).toBe('invalid_state');
  });

  it('a decision instant before the session clock is the typed clock_not_monotonic', () => {
    const session = unwrap(createReferenceSession({ intents: [] }));
    const first = unwrap(processShadowDecision(session, compliantIntent(1, T0 + 25_000)));
    const early = processShadowDecision(first.session, compliantIntent(2, T0 + 20_000));
    expect(early.ok).toBe(false);
    expect(!early.ok && early.errors[0]?.code).toBe('clock_not_monotonic');
  });
});

// ---------------------------------------------------------------------------
// The kill switch (thrown blocks ALL subsequent submissions)
// ---------------------------------------------------------------------------

describe('kill-switch-then-nothing', () => {
  it('every post-throw decision refuses with the kill-switch reason; the world receives nothing', () => {
    let session = unwrap(createReferenceSession({ intents: [] }));
    const before = unwrap(processShadowDecision(session, compliantIntent(1, T0 + 25_000)));
    expect(before.decision.kind).toBe('approve');
    expect(before.session.submissions.length).toBe(1);

    // THROW between the two decisions.
    session = unwrap(throwShadowKillSwitch(before.session, 'operator halt — drawdown review', (T0 + 25_500) as never));

    for (let index = 0; index < 3; index++) {
      const after = unwrap(processShadowDecision(session, compliantIntent(index + 2, T0 + 26_000 + index * 1_000)));
      expect(after.decision.kind).toBe('refuse');
      const failure = (after.decision as { failure: { dimension: string; reason: { dimension: string; reason: string } } }).failure;
      expect(failure.dimension).toBe('kill_switch');
      expect(failure.reason.reason).toBe('operator halt — drawdown review');
      // The world received NOTHING: the submission count NEVER grows.
      expect(after.session.submissions.length).toBe(1);
      expect(after.session.fills.length).toBe(1); // only the pre-throw decision's single fill (0.5 BTC @ one level)
      expect(after.fills.length).toBe(0);
      expect(after.outcome.disposition).toBe('refused');
      // The risk stage's limit states are ALL blocked with the kill-switch cause.
      const blocked = (after.refusal?.risk as { states: { state: string; reason: { cause: string } }[] }).states.filter((state) => state.state === 'blocked');
      expect(blocked.length).toBeGreaterThan(0);
      expect(blocked.every((state) => state.reason.cause === 'kill_switch')).toBe(true);
      session = after.session;
    }
  });

  it('the throw instant must not precede the session clock', () => {
    const session = unwrap(createReferenceSession({ intents: [] }));
    const first = unwrap(processShadowDecision(session, compliantIntent(1, T0 + 25_000)));
    const early = throwShadowKillSwitch(first.session, 'too early', (T0 + 20_000) as never);
    expect(early.ok).toBe(false);
    expect(!early.ok && early.errors[0]?.code).toBe('clock_not_monotonic');
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation (L12)
// ---------------------------------------------------------------------------

describe('tenant isolation', () => {
  it('a cross-tenant decision is the typed tenant_mismatch', () => {
    const session = unwrap(createReferenceSession({ intents: [] }));
    const outcome = processShadowDecision(session, crossTenantIntent());
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.errors[0]?.code).toBe('tenant_mismatch');
    // The world received nothing.
    expect(session.submissions.length).toBe(0);
  });

  it('a cross-tenant time machine is rejected at construction', () => {
    const machine = createScriptedMachine();
    const result = createShadowSession({
      mode: 'shadow',
      tenant: 'tenant-omega',
      project: 'project-omega',
      seed: 's',
      participant: 'p',
      world: createScriptedWorld(),
      worldSpec: {},
      timeMachine: machine, // tenant-shadow-alpha's machine
      cursorFrom: 'start',
      startAt: T0 as never,
      executionPolicy: referenceExecutionPolicy(),
      killSwitch: {}, // never reached — the machine's tenant binds first (L12)
      risk: { policy: undefined, marketEvents: [] },
      genesisPortfolio: { positions: [], cash: '100000' },
      venueState: referenceVenueState(),
      decisionSource: decisionSourceOf([]),
      lineage: { strategy: { specId: 's', version: 1 }, goal: { goalId: 'g', version: 1 }, constraintSet: { id: 'c', version: 1 }, windowId: 'w' },
    });
    // The machine's tenant binds first (L12) — the placeholder kill switch is never reached.
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('tenant_mismatch');
  });
});

// ---------------------------------------------------------------------------
// Mode honesty (L5/R23)
// ---------------------------------------------------------------------------

describe('mode honesty', () => {
  /** Build a session-shaped input with a mode override. */
  function sessionWithMode(mode: unknown): ReturnType<typeof createShadowSession> {
    const world = createScriptedWorld();
    const machine = createScriptedMachine();
    return createShadowSession({
      mode,
      tenant: 'tenant-shadow-alpha',
      project: 'project-shadow-alpha',
      seed: 's',
      participant: 'agent-shadow-alpha',
      world,
      worldSpec: {},
      timeMachine: machine,
      cursorFrom: 'start',
      startAt: T0 as never,
      executionPolicy: referenceExecutionPolicy(),
      killSwitch: referenceExecutionPolicy(),
      risk: { policy: undefined, marketEvents: [] },
      genesisPortfolio: { positions: [], cash: '100000' },
      venueState: referenceVenueState(),
      decisionSource: decisionSourceOf([]),
      lineage: { strategy: { specId: 's', version: 1 }, goal: { goalId: 'g', version: 1 }, constraintSet: { id: 'c', version: 1 }, windowId: 'w' },
    });
  }

  it("a 'live' claim is the typed fidelity_claim_dishonest", () => {
    const result = sessionWithMode('live');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('fidelity_claim_dishonest');
    expect(!result.ok && result.errors[0]?.message).toContain('live');
  });

  it("an 'exact_replay' claim is the typed fidelity_claim_dishonest", () => {
    const result = sessionWithMode('exact_replay');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('fidelity_claim_dishonest');
    expect(!result.ok && result.errors[0]?.message).toContain('exact_replay');
  });

  it('any other mode claim is dishonest too (one-member vocabulary)', () => {
    const result = sessionWithMode('paper_trading_plus');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('fidelity_claim_dishonest');
  });

  it('every outcome record carries the simulated-origin fidelity block', async () => {
    const session = await runReferenceScenario();
    for (const record of session.outcomeLog.records) {
      expect(record.lineage.fidelity.mode).toBe('shadow');
      expect(record.lineage.fidelity.fill_origin).toBe('simulated');
    }
  });
});

// ---------------------------------------------------------------------------
// The append-only outcome log (rewrite/reorder = typed shadow_log_rewrite)
// ---------------------------------------------------------------------------

describe('the append-only outcome log', () => {
  /** A minimal valid outcome record at the given ordinal over the given prior head. */
  function record(ordinal: number, priorChainHead: string, decisionRef = `xd:${ordinal}`): ReturnType<typeof mintShadowOutcomeRecord> {
    return mintShadowOutcomeRecord({
      ordinal,
      intentRef: `si:t030rw${ordinal}`,
      decisionRef,
      refusalRef: null,
      disposition: 'filled',
      fills: [],
      costs: { feeTotal: '0', notionalTotal: '0' },
      realizedOutcome: '0',
      unrealizedAtDecision: '0',
      priorChainHead,
      lineage: {
        sessionId: 'shs:01234567',
        fidelity: { mode: 'shadow', fill_origin: 'simulated' },
        executionPolicy: { policyId: 'xpol:1', version: 1 },
        riskPolicy: { policyId: 'rpol:1', version: 1 },
        configDigests: { worldConfigHash: 'aabbccdd', engineConfigHash: 'aabbccdd', dataset: 'd' },
        run: { runId: 'run-1', episodeId: 'ep-1' },
        cursor: { cursorId: 'cur-00000001', position: 0 },
        seed: 's',
        tenant: 't',
        project: 'p',
      },
      asOf: 1 as never,
    });
  }

  it('appends in order and folds the chain', () => {
    let log = startShadowOutcomeLog();
    const first = record(1, log.head);
    log = unwrap(appendShadowOutcome(log, first));
    const second = record(2, log.head);
    log = unwrap(appendShadowOutcome(log, second));
    expect(log.records.length).toBe(2);
    expect(log.head).not.toBe(log.records[0]?.priorChainHead);
  });

  it('an out-of-order ordinal is the typed shadow_log_rewrite', () => {
    const log = startShadowOutcomeLog();
    const first = record(1, log.head);
    const appended = unwrap(appendShadowOutcome(log, first));
    // A spliced record claiming ordinal 3 (the next position is 2).
    const splice = record(3, appended.head);
    const result = appendShadowOutcome(appended, splice);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('shadow_log_rewrite');
  });

  it('re-appending a recorded decision is the typed shadow_log_rewrite', () => {
    const log = startShadowOutcomeLog();
    const first = record(1, log.head);
    const appended = unwrap(appendShadowOutcome(log, first));
    // The same decision re-recorded at the correct ordinal (a rewrite).
    const replay = record(2, appended.head, first.decisionRef);
    const result = appendShadowOutcome(appended, replay);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('shadow_log_rewrite');
  });

  it('a record minted against a different history is the typed shadow_log_rewrite', () => {
    const log = startShadowOutcomeLog();
    const foreign = record(1, 'deadbeef');
    const result = appendShadowOutcome(log, foreign);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('shadow_log_rewrite');
  });

  it('a foreign session record is the typed shadow_log_rewrite', () => {
    const log = startShadowOutcomeLog();
    const first = record(1, log.head);
    const appended = unwrap(appendShadowOutcome(log, first));
    // A record minted for a DIFFERENT session (a foreign history).
    const other = record(2, appended.head);
    const mutated = { ...other, lineage: { ...other.lineage, sessionId: 'shs:ffffffff' } };
    const result = appendShadowOutcome(appended, mutated);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('shadow_log_rewrite');
  });
});

// ---------------------------------------------------------------------------
// The fork (a second shadow book without rewinding the first)
// ---------------------------------------------------------------------------

describe('forkCursor — a second shadow book without rewinding the first', () => {
  it('the fork consumes the same deltas; the first cursor is NOT rewound', async () => {
    // Drive one decision on the primary session.
    const primary = unwrap(createReferenceSession({ intents: [] }));
    const first = unwrap(processShadowDecision(primary, referenceIntentStream()[0]!));
    const session = first.session;
    const cursorBefore = unwrapMachine(session.timeMachine.getCursor(session.cursorId));
    expect(cursorBefore.delivered).toBe(2); // mk-0001 + mk-0002 (the inclusive boundary at d1)

    // Fork: the second book's cursor opens at the IDENTICAL anchors.
    const forked = unwrap(forkShadowSession(session, { decisionSource: decisionSourceOf([]) }));
    expect(forked.cursorId).not.toBe(session.cursorId);

    // Drain both at a later instant: both receive the SAME delta (mk-0003 onward).
    const at = (T0 + 90_000) as never;
    const primaryDrain = unwrapMachine(session.timeMachine.drainCursor(session.cursorId, at));
    const forkDrain = unwrapMachine(forked.timeMachine.drainCursor(forked.cursorId, at));
    expect(primaryDrain.records.map((r) => r.record_id)).toEqual(forkDrain.records.map((r) => r.record_id));

    // The FIRST cursor was never rewound: its delivered count grew only by its own drains.
    const cursorAfter = unwrapMachine(session.timeMachine.getCursor(session.cursorId));
    expect(cursorAfter.position).toBe(primaryDrain.position);
    expect(cursorAfter.delivered).toBe(cursorBefore.delivered + primaryDrain.records.length);
  });
});

// ---------------------------------------------------------------------------
// The golden scenario's exact facts
// ---------------------------------------------------------------------------

describe('the golden scenario (hand-derived exact facts)', () => {
  it('the dispositions, the book, and the outcome digest match the literals', async () => {
    const session = await runReferenceScenario();
    expect(session.outcomeLog.records.map((record) => record.disposition)).toEqual([...GOLDEN_DISPOSITIONS]);
    // The final book — every number hand-derived in fixtures.ts's header.
    const book = session.book;
    expect(book.cash).toBe(GOLDEN_FINAL_BOOK.cash);
    expect(book.realizedPnl).toBe(GOLDEN_FINAL_BOOK.realizedPnl);
    expect(book.positions.length).toBe(GOLDEN_FINAL_BOOK.positions.length);
    for (let index = 0; index < GOLDEN_FINAL_BOOK.positions.length; index++) {
      const expected = GOLDEN_FINAL_BOOK.positions[index];
      const actual = book.positions[index];
      expect(actual?.venue).toBe(expected?.venue);
      expect(actual?.instrument).toBe(expected?.instrument);
      expect(actual?.quantity).toBe(expected?.quantity);
      expect(actual?.costBasis).toBe(expected?.costBasis);
    }
    expect(shadowOutcomeDigest(session.outcomeLog)).toBe(GOLDEN_OUTCOME_DIGEST);
    // The run is finished; the audit trail carries one record per decision.
    expect(session.finished).toBe(true);
    expect(session.auditLog.records.length).toBe(7);
    expect(session.decisions.length).toBe(7);
    expect(session.ticks.length).toBe(7);
    // Every tick carries the drain's firewall audit (the shadow audit trail).
    for (const tick of session.ticks) {
      expect(tick.drainAudit).not.toBeNull();
    }
  });

  it('the exposure fold equals the book for taker-role fills (the invariant)', () => {
    const session = unwrap(createReferenceSession({ intents: [] }));
    const d1 = unwrap(processShadowDecision(session, referenceIntentStream()[0]!));
    const d2 = unwrap(processShadowDecision(d1.session, referenceIntentStream()[1]!));
    // At d2 the two pending fills became visible: the exposure (pre-tick book + fills) IS the book.
    const exposure = d2.session.exposures[d2.session.exposures.length - 1]!;
    expect(exposure.cash).toBe(d2.session.book.cash);
    const btcPosition = exposure.positions.find((position) => position.instrument === 'BTC-USD');
    expect(btcPosition?.quantity).toBe('0.75');
    expect(btcPosition?.notional).toBe('37500'); // 0.75 x the 50000 mark — hand-derived
  });
});

// ---------------------------------------------------------------------------
// The run loop
// ---------------------------------------------------------------------------

describe('the run loop', () => {
  it('drives the injected source to exhaustion and finishes the world', async () => {
    const session = unwrap(createReferenceSession());
    const finished = unwrap(await runShadowSession(session));
    expect(finished.finished).toBe(true);
    expect(finished.processedIntentIds.length).toBe(7);
  });

  it('fails loudly on a malformed intent (the typed failure carries the decision)', async () => {
    const session = unwrap(createReferenceSession({ intents: [{ bad: 'intent' }] }));
    const result = await runShadowSession(session);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('invalid_type');
  });
});
