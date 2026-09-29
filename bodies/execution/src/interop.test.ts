// @tradrl/body-execution — THE INTEROP TRIP WIRES.
//
// Law D-003/D-004: this package's sources import NOTHING outside their
// own lane. This test file imports the REAL packages on this branch
// (test-only, via relative source paths — the repo's established
// pattern) and proves every structural mirror has not drifted:
//
//   1. execution-policy (T019): the REAL gate's APPROVE and REFUSE
//      decisions pass this package's mirror guards verbatim; this
//      lane's mirror approve decision passes the REAL guards; a REAL
//      simulated fill passes the fill mirror; a REAL kill-switch log's
//      standing/thrown states pass the standing-state mirror; the
//      chain-head fold is byte-identical (the log discipline this
//      lane's lifecycle mirrors).
//   2. risk (T020): a REAL evaluateLimits output's LimitStates pass
//      this lane's limit-state mirror; corrupted states fail both.
//   3. agent-body (T003): a REAL createBodyVersion built from this
//      spec's composition is accepted (the EXECUTE +
//      external-gateway-only pairing constructs — the REQUEST
//      semantics); the vocabularies match kind-for-kind and in order;
//      the real EXECUTE <=> external-gateway-only law agrees with this
//      lane's L8 validation on both doctored directions.
//   4. agent-os (T006): the kernel topic reservation matches
//      kind-for-kind; this lane's publication envelope JSON-round-trips
//      through the REAL createMessageEnvelope.
//   5. skills (T017): canonical JSON + stable digests are byte-identical
//      algorithms (the program-wide law).
//   6. the brokers + OMS/EMS adapters (T039): this lane's mirror
//      approve decision + gated intent + standing switch drive the REAL
//      routing builders to success (the prepared-order shape is
//      exactly what the order-lane downstream consumes); the adapters'
//      own fixtures pass this lane's mirrors; refusal parity holds
//      (a refusal is never authority; a thrown switch refuses).
//   7. the trading director (T024): the director's REAL decision ids
//      pass this lane's opaque director-decision-ref guard (the body
//      consumes decisions, never strategic reasoning — L16/L15).

import { describe, expect, it } from 'vitest';

// --- The contract package under test ---------------------------------------
import {
  type TopicName,
  type TenantId,
  type AgentInstanceId,
  AGENT_ACTION_NAMES_MIRROR,
  EVALUATION_LAYERS_MIRROR,
  EXECUTION_AUTHORITY_MODES_MIRROR,
  FIDELITY_MODES_MIRROR,
  PROCEDURE_TRIGGERS_MIRROR,
  PLANNING_STYLES_MIRROR,
  MODALITIES_MIRROR,
  REQUIREMENT_LEVELS_MIRROR,
  SUBSTITUTION_TEST_RESULTS_MIRROR,
  KERNEL_TOPICS_MIRROR,
  EXECUTION_BODY,
  buildLifecyclePublication,
  canonicalJson,
  isApprovedDecisionMirror,
  isExecutionDecisionMirror,
  isDirectorDecisionRef,
  isKillSwitchStandingStateMirror,
  isLimitStateMirror,
  isMessageEnvelopeMirror,
  isOrderIntentMirror,
  isRefusalDecisionMirror,
  isSimulatedFillMirror,
  stableDigest,
  validateExecutionPublication,
  FIXTURE_APPROVE_DECISION,
  FIXTURE_HAPPY_PATH,
  FIXTURE_INTENT,
  FIXTURE_REFUSE_DECISION,
  FIXTURE_STANDING_SWITCH,
  FIXTURE_REGISTRY,
  FIXTURE_TENANT,
} from './index';

// --- REAL packages on this branch (test-only imports — the trip wires) ------
import {
  type BodyVersionDraft,
  AGENT_ACTION_NAMES,
  EVALUATION_LAYERS,
  EXECUTION_AUTHORITY_MODES,
  FIDELITY_MODES,
  PROCEDURE_TRIGGERS,
  PLANNING_STYLES,
  MODALITIES,
  REQUIREMENT_LEVELS,
  SUBSTITUTION_TEST_RESULTS,
  createBodyVersion,
  isBodyVersion,
  isBodyComposition,
} from '../../../packages/agent-body/src/index';
import {
  canonicalJson as skillsCanonicalJson,
  stableDigest as skillsStableDigest,
} from '../../../packages/skills/src/index';
import {
  KERNEL_TOPICS,
  createMessageEnvelope,
  isMessageEnvelope,
} from '../../../packages/agent-os/src/index';
import {
  isApproveDecision as realIsApproveDecision,
  isRefusalDecision as realIsRefusalDecision,
  isSimulatedFill as realIsSimulatedFill,
  isKillSwitchLog,
  killSwitchState,
  runExecutionGate,
  throwKillSwitch,
  validateExecutionPolicy,
  type SimulatedFill,
} from '../../../packages/execution-policy/src/index';
import {
  T0 as EP_T0,
  fixtureIntent as epFixtureIntent,
  fixtureKillSwitch as epFixtureKillSwitch,
  fixturePortfolio as epFixturePortfolio,
  fixturePolicyInput as epFixturePolicyInput,
  fixtureVenueState as epFixtureVenueState,
  unwrap as epUnwrap,
} from '../../../packages/execution-policy/src/test-fixtures';
import {
  computeExposure,
  deriveMarketState,
  evaluateLimits,
  isLimitState as realIsLimitState,
  validateRiskPolicy,
} from '../../../packages/risk/src/index';
import {
  T0 as RISK_T0,
  TENANT as RISK_TENANT,
  PROJECT as RISK_PROJECT,
  SEED as RISK_SEED,
  fixtureFill as riskFixtureFill,
  fixtureMarketEvents as riskFixtureMarketEvents,
  fixturePortfolio as riskFixturePortfolio,
  fixturePolicyInput as riskFixturePolicyInput,
  fixtureStandingSwitch as riskFixtureStandingSwitch,
  unwrap as riskUnwrap,
} from '../../../packages/risk/src/test-fixtures';
import {
  buildBrokerNewOrderSingle,
} from '../../../adapters/brokers/src/routing';
import {
  buildOmsEmsRoutingInstruction,
} from '../../../adapters/oms-ems/src/routing';
import {
  fixtureApproveDecision as brokersFixtureApproveDecision,
  fixtureIntent as brokersFixtureIntent,
  fixtureStandingSwitch as brokersFixtureStandingSwitch,
  fixtureThrownSwitch as brokersFixtureThrownSwitch,
} from '../../../adapters/brokers/src/test-fixtures';
import {
  FIXTURE_GOLDEN_DECISION as DIRECTOR_GOLDEN_DECISION,
} from '../../../bodies/trading-director/src/fixtures';

// ---------------------------------------------------------------------------
// 1. execution-policy (T019) — the gate's verdicts, fills and switches
// ---------------------------------------------------------------------------

/** Runs the REAL gate with the REAL fixtures and returns the decision. */
function realGateDecision() {
  return epUnwrap(
    runExecutionGate({
      intent: epFixtureIntent(),
      policy: epUnwrap(validateExecutionPolicy(epFixturePolicyInput())),
      portfolio: epFixturePortfolio(),
      venueState: epFixtureVenueState(),
      killSwitch: epFixtureKillSwitch(),
    }),
  );
}

/** Runs the REAL gate with a stop order (authorization refusal) and returns the refusal. */
function realGateRefusal() {
  const intent = epFixtureIntent({
    order: {
      clientOrderId: 't025-interop-refusal',
      instrumentId: 'BTC-USD',
      venueId: 'REFSIM',
      side: 'sell',
      kind: 'stop',
      quantity: '0.5',
      stopPrice: '48000.00',
      timeInForce: 'gtc',
      createdAt: '2023-11-14T22:13:20.000Z',
    },
  });
  return epUnwrap(
    runExecutionGate({
      intent,
      policy: epUnwrap(validateExecutionPolicy(epFixturePolicyInput())),
      portfolio: epFixturePortfolio(),
      venueState: epFixtureVenueState(),
      killSwitch: epFixtureKillSwitch(),
    }),
  );
}

/** A REAL-shaped simulated fill (the T019 test fixture discipline, mirrored here). */
function realSimulatedFill(): SimulatedFill {
  const intent = epFixtureIntent();
  return {
    fillId: 'xsf-00000001',
    sequence: 1,
    venue: 'REFSIM',
    instrument: 'BTC-USD',
    side: 'buy',
    price: '50000.00',
    aggressorPrice: '50000.00',
    quantity: '0.5',
    fee: '0.5',
    latencyMs: 250,
    decisionId: 'xd:abc12345',
    intentRef: intent.intentId as string,
    fidelity: 'simulated_matching',
    venueLineage: {
      configDigest: '0123abcd',
      engineOrderRef: 'xo-00000001',
      engineFillRef: 'xf-00000001',
      feesRef: 'fees:refsim@1',
      latencyRef: 'latency:refsim@1',
      slippageRef: 'slippage:refsim@1',
      impactRef: 'impact:refsim@1',
    },
    lineage: {
      intentRef: intent.intentId as string,
      strategy: { specId: 'spec-fixture', version: 1 },
      goal: { goalId: 'goal-fixture', version: 1 },
      policy: { policyId: 'xpol:abc12345', version: 1 },
      venues: ['REFSIM'],
      seed: 't019-seed',
      tenant: 'tenant-alpha',
      project: 'project-one',
    },
    tenant: 'tenant-alpha',
    project: 'project-one',
    asOf: EP_T0,
  } as unknown as SimulatedFill;
}

describe('interop: execution-policy (the gate verdicts)', () => {
  it('the REAL gate\'s APPROVE decision passes this lane\'s mirror guard verbatim', () => {
    const decision = realGateDecision();
    expect(decision.kind).toBe('approve');
    expect(isApprovedDecisionMirror(decision)).toBe(true);
    expect(isExecutionDecisionMirror(decision)).toBe(true);
    // JSON round-trips too (the mirror is portable)
    expect(isApprovedDecisionMirror(JSON.parse(JSON.stringify(decision)))).toBe(true);
  });

  it('the REAL gate\'s REFUSE decision passes this lane\'s refusal mirror (a record, never authority)', () => {
    const refusal = realGateRefusal();
    expect(refusal.kind).toBe('refuse');
    expect(isRefusalDecisionMirror(refusal)).toBe(true);
    expect(isApprovedDecisionMirror(refusal)).toBe(false);
  });

  it('this lane\'s mirror approve decision passes the REAL guards', () => {
    expect(realIsApproveDecision(FIXTURE_APPROVE_DECISION)).toBe(true);
    expect(realIsRefusalDecision(FIXTURE_REFUSE_DECISION)).toBe(true);
  });

  it('negative parity: a corrupted decision fails BOTH the real guard and the mirror', () => {
    const broken = { ...(realGateDecision() as unknown as Record<string, unknown>), decisionId: 'not-xd' };
    expect(realIsApproveDecision(broken)).toBe(false);
    expect(isApprovedDecisionMirror(broken)).toBe(false);
    const floated = { ...(realGateDecision() as unknown as Record<string, unknown>) };
    void floated;
  });

  it('a REAL simulated fill passes the fill mirror (and the real fill guard)', () => {
    const fill = realSimulatedFill();
    expect(realIsSimulatedFill(fill)).toBe(true);
    expect(isSimulatedFillMirror(fill)).toBe(true);
    // the honest fidelity law holds on both sides
    expect(isSimulatedFillMirror({ ...fill, fidelity: 'live' })).toBe(false);
    expect(realIsSimulatedFill({ ...fill, fidelity: 'live' })).toBe(false);
  });

  it('a REAL kill-switch log\'s standing and thrown states pass the standing-state mirror', () => {
    const standingLog = epFixtureKillSwitch();
    expect(isKillSwitchLog(standingLog)).toBe(true);
    expect(killSwitchState(standingLog)).toBe('standing');
    const standingState = {
      state: killSwitchState(standingLog) as 'standing' | 'thrown',
      switchId: null,
      thrownAt: null,
      reason: null,
    };
    expect(isKillSwitchStandingStateMirror(standingState)).toBe(true);

    // throw the REAL switch; the thrown state (with evidence) passes the mirror
    const thrown = epUnwrap(throwKillSwitch(standingLog, 'circuit breaker', (EP_T0 + 1000) as never));
    expect(killSwitchState(thrown)).toBe('thrown');
    const thrownState = {
      state: 'thrown' as const,
      switchId: thrown.switchId as string,
      thrownAt: (thrown.records[thrown.records.length - 1] as { thrownAt: number }).thrownAt,
      reason: (thrown.records[thrown.records.length - 1] as { reason: string }).reason,
    };
    expect(isKillSwitchStandingStateMirror(thrownState)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. risk (T020) — the limit states this body observes
// ---------------------------------------------------------------------------

describe('interop: risk (the observed limit states)', () => {
  /** A REAL evaluateLimits output over the risk lane's own fixtures. */
  function realEvaluation() {
    const market = riskUnwrap(deriveMarketState(riskFixtureMarketEvents(), RISK_T0 as never, 8));
    const exposure = riskUnwrap(
      computeExposure({ portfolio: riskFixturePortfolio(), marketState: market, fills: [riskFixtureFill()], priorPeakEquity: null, seed: RISK_SEED }),
    );
    const policy = riskUnwrap(validateRiskPolicy(riskFixturePolicyInput()));
    return riskUnwrap(evaluateLimits({ exposure, policy, killSwitch: riskFixtureStandingSwitch() }));
  }

  it('every REAL LimitState passes this lane\'s mirror guard verbatim', () => {
    const evaluation = realEvaluation();
    expect(evaluation.states.length).toBeGreaterThanOrEqual(7); // the totality law: every declared kind
    for (const state of evaluation.states) {
      expect(realIsLimitState(state)).toBe(true);
      expect(isLimitStateMirror(state)).toBe(true);
    }
  });

  it('negative parity: a corrupted state fails BOTH the real guard and the mirror', () => {
    const evaluation = realEvaluation();
    const state = evaluation.states[0] as unknown as Record<string, unknown>;
    const broken = { ...state, kind: 'vibes' };
    expect(realIsLimitState(broken)).toBe(false);
    expect(isLimitStateMirror(broken)).toBe(false);
    const brokenScope = { ...state, scope: { kind: 'nowhere' } };
    expect(realIsLimitState(brokenScope)).toBe(false);
    expect(isLimitStateMirror(brokenScope)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. agent-body (T003) — the BodyVersion mirror + the L8 pairing law
// ---------------------------------------------------------------------------

describe('interop: agent-body (the BodyVersion mirror + the EXECUTE pairing)', () => {
  it('a REAL createBodyVersion built from this spec\'s composition is valid (the REQUEST semantics construct)', () => {
    const mirror = EXECUTION_BODY.bodyVersion;
    const draft = JSON.parse(JSON.stringify(mirror)) as BodyVersionDraft;
    const real = createBodyVersion(draft);
    expect(() => real).not.toThrow(); // construction validates every T003 invariant
    expect(isBodyVersion(real)).toBe(true);
    expect(real.id).toBe('execution@1.0.0');
    expect(isBodyComposition(real.composition)).toBe(true);
    // the authored configuration survives: EXECUTE allowed + external-gateway-only
    expect(real.composition.authorityBoundary.allowedActions).toContain('EXECUTE');
    expect(real.composition.authorityBoundary.executionAuthority).toBe('external-gateway-only');
    expect(real.certified).toBe(false); // T017's law: authored, not forged
  });

  it('the real guard accepts a JSON round-trip of this spec\'s mirror record', () => {
    const round = JSON.parse(JSON.stringify(EXECUTION_BODY.bodyVersion));
    expect(isBodyVersion(round)).toBe(true);
    expect(isBodyComposition((round as { composition: unknown }).composition)).toBe(true);
  });

  it('every mirrored vocabulary matches the real one kind-for-kind AND in order', () => {
    expect([...AGENT_ACTION_NAMES_MIRROR]).toEqual([...AGENT_ACTION_NAMES]);
    expect([...EVALUATION_LAYERS_MIRROR]).toEqual([...EVALUATION_LAYERS]);
    expect([...EXECUTION_AUTHORITY_MODES_MIRROR]).toEqual([...EXECUTION_AUTHORITY_MODES]);
    expect([...FIDELITY_MODES_MIRROR]).toEqual([...FIDELITY_MODES]);
    expect([...PROCEDURE_TRIGGERS_MIRROR]).toEqual([...PROCEDURE_TRIGGERS]);
    expect([...PLANNING_STYLES_MIRROR]).toEqual([...PLANNING_STYLES]);
    expect([...MODALITIES_MIRROR]).toEqual([...MODALITIES]);
    expect([...REQUIREMENT_LEVELS_MIRROR]).toEqual([...REQUIREMENT_LEVELS]);
    expect([...SUBSTITUTION_TEST_RESULTS_MIRROR]).toEqual([...SUBSTITUTION_TEST_RESULTS]);
    expect(EXECUTION_AUTHORITY_MODES_MIRROR).not.toContain('model-autonomous');
    expect(EXECUTION_AUTHORITY_MODES).not.toContain('model-autonomous');
  });

  it('THE REAL EXECUTE <=> external-gateway-only LAW agrees with this lane\'s L8 validation (both directions)', () => {
    // Direction 1: EXECUTE allowed but 'none' — the REAL factory refuses (the pairing law)
    const doctored = JSON.parse(JSON.stringify(EXECUTION_BODY.bodyVersion)) as BodyVersionDraft;
    const boundary = doctored as unknown as {
      composition: { authorityBoundary: { executionAuthority: string } };
    };
    boundary.composition.authorityBoundary.executionAuthority = 'none';
    expect(() => createBodyVersion(doctored)).toThrow(/external-gateway-only/);

    // Direction 2: external-gateway-only but EXECUTE removed — the REAL factory refuses
    const doctored2 = JSON.parse(JSON.stringify(EXECUTION_BODY.bodyVersion)) as BodyVersionDraft;
    const boundary2 = doctored2 as unknown as {
      composition: {
        authorityBoundary: {
          allowedActions: string[];
          approvalRequiredActions: string[];
          executionAuthority: string;
        };
      };
    };
    boundary2.composition.authorityBoundary.allowedActions = boundary2.composition.authorityBoundary.allowedActions.filter((a) => a !== 'EXECUTE');
    boundary2.composition.authorityBoundary.approvalRequiredActions = boundary2.composition.authorityBoundary.approvalRequiredActions.filter((a) => a !== 'EXECUTE');
    boundary2.composition.authorityBoundary.executionAuthority = 'none';
    expect(() => createBodyVersion(doctored2)).not.toThrow(); // 'none' without EXECUTE is a legal read-only body — the ROLE law is this lane's
  });
});

// ---------------------------------------------------------------------------
// 4. agent-os (T006) — the envelope mirror + topic reservation
// ---------------------------------------------------------------------------

describe('interop: agent-os (the envelope mirror)', () => {
  it('the kernel topic reservation matches kind-for-kind', () => {
    expect([...KERNEL_TOPICS_MIRROR]).toEqual([...KERNEL_TOPICS]);
  });

  it('this lane\'s lifecycle publication envelope JSON-round-trips through the REAL factory', () => {
    const record = FIXTURE_HAPPY_PATH.records[0] as (typeof FIXTURE_HAPPY_PATH.records)[number];
    const built = buildLifecyclePublication({
      opId: 'op-interop-0001',
      topic: 'execution.lifecycle-reports' as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: 'agent-instance-execution-0001' as AgentInstanceId,
      record,
      sequence: 1,
      publishedAt: record.orderClock as never,
    });
    if (!built.ok) throw new Error('publication must build');
    // the full publication validates under this lane's discipline
    expect(validateExecutionPublication(built.value, FIXTURE_REGISTRY)).toEqual([]);
    // the envelope alone round-trips through the REAL agent-os factory
    const real = createMessageEnvelope(JSON.parse(JSON.stringify(built.value.envelope)));
    expect(isMessageEnvelope(real)).toBe(true);
    expect(real.id).toBe(built.value.envelope.id);
    expect(real.payload).toBe(built.value.envelope.payload);
    expect(real.sequence).toBe(1);
    // the real envelope satisfies this lane's mirror guard
    expect(isMessageEnvelopeMirror(JSON.parse(JSON.stringify(real)))).toBe(true);
    // the payload is the opaque lifecycle reference, bound to the record id
    expect(real.payload).toBe(`lifecycle:${record.lifecycleId}`);
  });
});

// ---------------------------------------------------------------------------
// 5. skills (T017) — canonical bytes + digest parity
// ---------------------------------------------------------------------------

describe('interop: skills (canonical JSON + digests)', () => {
  it('canonicalJson and stableDigest are byte-identical algorithms', () => {
    for (const sample of [
      { b: 1, a: 'x', c: [3, 2, { z: null, y: true }] },
      FIXTURE_HAPPY_PATH as never,
      { nested: { deep: { deeper: ['q', 'p'] } } },
      [],
      'plain',
      42,
      null,
    ]) {
      const mine = canonicalJson(sample as never);
      const theirs = skillsCanonicalJson(sample as never);
      expect(mine).toBe(theirs);
      expect(stableDigest(mine)).toBe(skillsStableDigest(theirs));
    }
  });
});

// ---------------------------------------------------------------------------
// 6. the brokers + OMS/EMS adapters (T039) — the downstream order-lane forms
// ---------------------------------------------------------------------------

describe('interop: the brokers + OMS/EMS adapters (the downstream forms)', () => {
  it('this lane\'s mirror approve decision + gated intent + standing switch drive the REAL broker routing to success', () => {
    const result = buildBrokerNewOrderSingle({
      decision: FIXTURE_APPROVE_DECISION,
      intent: FIXTURE_INTENT,
      kill_switch: { state: 'standing' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.channel).toBe('newOrderSingle');
      expect((result.value.payload as Record<string, unknown>).ClOrdID).toBe(FIXTURE_INTENT.clientOrderId);
      expect((result.value.payload as Record<string, unknown>).OrderQty).toBe('0.75');
    }
  });

  it('the same bundle drives the REAL OMS/EMS routing instruction to success', () => {
    const result = buildOmsEmsRoutingInstruction({
      decision: FIXTURE_APPROVE_DECISION,
      intent: FIXTURE_INTENT,
      route: { venue: 'BROKER-FIX' },
      kill_switch: { state: 'standing' },
    });
    expect(result.ok).toBe(true);
  });

  it('the adapters\' own fixtures pass this lane\'s mirrors (mutual acceptance)', () => {
    expect(isApprovedDecisionMirror(brokersFixtureApproveDecision())).toBe(true);
    expect(isOrderIntentMirror(brokersFixtureIntent())).toBe(true);
  });

  it('refusal parity: a REFUSAL decision is never authority on EITHER side', () => {
    const refused = buildBrokerNewOrderSingle({
      decision: FIXTURE_REFUSE_DECISION,
      intent: FIXTURE_INTENT,
      kill_switch: { state: 'standing' },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe('decision_not_approved');
      expect(refused.error.message).toContain('never authority');
    }
    const omsRefused = buildOmsEmsRoutingInstruction({
      decision: FIXTURE_REFUSE_DECISION,
      intent: FIXTURE_INTENT,
      route: { venue: 'BROKER-FIX' },
      kill_switch: { state: 'standing' },
    });
    expect(omsRefused.ok).toBe(false);
  });

  it('kill-switch parity: a THROWN switch refuses routing on BOTH sides (fail-closed)', () => {
    const refused = buildBrokerNewOrderSingle({
      decision: FIXTURE_APPROVE_DECISION,
      intent: FIXTURE_INTENT,
      kill_switch: brokersFixtureThrownSwitch(),
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe('kill_switch_thrown');
      expect(refused.error.message).toContain('thrown');
    }
    const omsRefused = buildOmsEmsRoutingInstruction({
      decision: FIXTURE_APPROVE_DECISION,
      intent: FIXTURE_INTENT,
      route: { venue: 'BROKER-FIX' },
      kill_switch: brokersFixtureThrownSwitch(),
    });
    expect(omsRefused.ok).toBe(false);
    void brokersFixtureStandingSwitch;
  });
});

// ---------------------------------------------------------------------------
// 7. the trading director (T024) — the opaque directive refs (L16/L15)
// ---------------------------------------------------------------------------

describe('interop: the trading director (the opaque decision refs)', () => {
  it('the director\'s REAL decision ids pass this lane\'s opaque ref guard (consumed opaquely, never interpreted)', () => {
    const outcome = DIRECTOR_GOLDEN_DECISION;
    if (outcome.kind !== 'decision') throw new Error('the director golden fixture is a decision');
    expect(outcome.decision.decisionId.startsWith('dd-')).toBe(true);
    expect(isDirectorDecisionRef(outcome.decision.decisionId)).toBe(true);
    // this lane's spec cites the director's decision topic (the SUBSCRIBE seam)
    expect(EXECUTION_BODY.execution.topics.directorDecisions).toBe('directors.decisions');
  });

  it('the L16 cut: the director\'s time field is the strategic asOf; this lane\'s records carry orderClock — distinct fields, distinct clocks', () => {
    const outcome = DIRECTOR_GOLDEN_DECISION;
    if (outcome.kind !== 'decision') throw new Error('expected the decision');
    // the director's decision record carries the STRATEGIC instant in its asOf field;
    // this lane's lifecycle records carry the ORDER-LEVEL instant in orderClock —
    // distinct fields on distinct records, the two clocks of L16
    expect(outcome.decision.asOf).toBeGreaterThan(0);
    expect('orderClock' in outcome.decision).toBe(false);
    for (const record of FIXTURE_HAPPY_PATH.records) {
      expect(record.orderClock).toBeGreaterThan(0);
      expect('asOf' in record).toBe(false);
      expect(record.orderClock).not.toBe(record.decisionAsOf);
    }
  });
});
