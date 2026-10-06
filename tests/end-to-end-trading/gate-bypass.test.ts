// tests/end-to-end-trading/gate-bypass.test.ts — THE GATE-BYPASS TESTS
// (suite 4/5).
//
// Work Order T048: "a gate-bypass test proving execution without gateway
// authorization is a typed error" — the L8/L20 law: models NEVER bypass
// the gate stack. Every path to a venue without a VALID, content-addressed
// APPROVE decision is a TYPED ERROR:
//   - `decision_not_approved` — no decision, a refusal decision, or a
//     FORGED xd: id (the forgery law: the id must match the content);
//   - `kill_switch_thrown` — fail-closed submission under a thrown switch;
//   - `execution_authority_granted` — a body spec claiming model-autonomous
//     execution is refused at the body-law level.

import { describe, expect, it } from 'vitest';
import {
  runEndToEndScenario,
  REFERENCE_SCENARIO,
  gatewayOrderRequestMirror,
  runExecutionGateMirror,
  acceptExecutionIntakeMirror,
  prepareOrderMirror,
  appendOrderLifecycleEventMirror,
  authorityViolationsOf,
  mintApproveDecisionId,
  type ApproveDecisionMirror,
  type BodyVersionMirror,
  type ExecutionPolicyMirror,
  deepCloneJson,
} from '../../examples/end-to-end-trading/src/index';

const runResult = runEndToEndScenario();
if (!runResult.ok) throw new Error(`reference slice failed: ${JSON.stringify(runResult.errors)}`);
const run = runResult.value;

const realApprove = run.stages.riskGateway.decisions.find(
  (decision): decision is ApproveDecisionMirror => decision.kind === 'approve',
) as ApproveDecisionMirror;
const realIntent = run.stages.strategy.run.intents.find(
  (intent) => intent.intentId === realApprove.intentRef,
) ?? run.stages.strategy.run.intents[0];
const killSwitchStanding = { state: 'standing' as const, switchId: null, thrownAt: null, reason: null };
const route = { venue: 'REFSIM', adapterRef: 'adapter:paper-exchange@1.0.0', channelRef: 'chan:refsim-orders' };
const translationInput = (decision: unknown, killSwitch: unknown = killSwitchStanding) => ({
  decision,
  order: realIntent.order,
  route,
  grantRef: 'grant:e2e-reference-market-limits',
  credentialRef: 'cred:refsim/e2e-reference@1',
  killSwitch: killSwitch as never,
  asOf: REFERENCE_SCENARIO.instants.orderClockBase + 1,
});

describe('L8: the translation contract refuses every un-authorized order request', () => {
  it('NO decision at all is the typed decision_not_approved', () => {
    const result = gatewayOrderRequestMirror(translationInput(null));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'decision_not_approved')).toBe(true);
    }
  });

  it('a REFUSAL decision is the typed decision_not_approved (refusals never execute)', () => {
    const refusal = run.stages.riskGateway.decisions.find((decision) => decision.kind === 'refuse');
    const result = gatewayOrderRequestMirror(translationInput(refusal));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'decision_not_approved')).toBe(true);
    }
  });

  it('a decision whose kind is neither approve nor refuse is the typed decision_not_approved', () => {
    const result = gatewayOrderRequestMirror(translationInput({ kind: 'self-approved', decisionId: 'xd:00000000', intentRef: realIntent.intentId }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'decision_not_approved')).toBe(true);
    }
  });

  it('a FORGED decision id (tampered content, kept id) is the typed decision_not_approved (the forgery law)', () => {
    const forged: ApproveDecisionMirror = deepCloneJson(realApprove);
    // Keep the id, change the content: swap one check's outcome.
    const tampered = {
      ...forged,
      checks: forged.checks.map((check, index) => (index === 0 ? { ...check, dimension: 'credentials' } : check)),
    };
    expect(mintApproveDecisionId(tampered)).not.toBe(tampered.decisionId); // the id no longer matches the content
    const result = gatewayOrderRequestMirror(translationInput(tampered));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'decision_not_approved')).toBe(true);
    }
  });

  it('a credential-bearing bundle is the typed credential_value_present (the opacity trip wire)', () => {
    const contaminated = { ...realIntent.order, secret: 'hunter2' };
    const result = gatewayOrderRequestMirror({ ...translationInput(realApprove), order: contaminated });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'credential_value_present')).toBe(true);
    }
  });

  it('a THROWN kill switch refuses the build with the typed kill_switch_thrown (fail-closed)', () => {
    const result = gatewayOrderRequestMirror(
      translationInput(realApprove, { state: 'thrown', switchId: 'ksw:e2e-reference-1', thrownAt: 1, reason: 'circuit breaker' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'kill_switch_thrown')).toBe(true);
    }
  });

  it('the VALID decision passes the translation contract (the one legal path to a venue)', () => {
    const result = gatewayOrderRequestMirror(translationInput(realApprove));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requestRef.startsWith('gor:')).toBe(true);
      expect(result.value.killSwitchStanding).toBe('standing');
      expect(result.value.credentialRef.startsWith('cred:')).toBe(true); // a REF, never a value
    }
  });
});

describe('L8: the gate machine itself fails closed on a thrown switch', () => {
  it('the first check (kill_switch, declared first) refuses with the kill_switch dimension', () => {
    const decision = runExecutionGateMirror({
      intent: {
        intentId: realIntent.intentId,
        tenant: realIntent.tenant,
        project: realIntent.project,
        order: {
          instrumentId: realIntent.order.instrumentId,
          venueId: realIntent.order.venueId,
          side: realIntent.order.side,
          kind: realIntent.order.kind,
          quantity: realIntent.order.quantity,
          price: realIntent.order.price,
        },
        strategy: realIntent.strategy,
        goal: realIntent.goal,
        seed: realIntent.seed,
      },
      policy: REFERENCE_SCENARIO.executionPolicy as ExecutionPolicyMirror,
      portfolio: { positionOf: () => '0', equity: REFERENCE_SCENARIO.initialCash },
      venueState: {
        asOf: REFERENCE_SCENARIO.instants.strategyAsOf,
        instruments: [
          { venue: 'REFSIM', instrument: realIntent.order.instrumentId, instrumentClass: 'crypto', referencePrice: '50750.00', rateWindowOrderCount: 0 },
        ],
      },
      killSwitch: { state: 'thrown', switchId: 'ksw:e2e-reference-1', thrownAt: 1, reason: 'circuit breaker' },
      digestOf: () => 'deadbeef',
    });
    expect(decision.kind).toBe('refuse');
    if (decision.kind === 'refuse') {
      expect(decision.failure.dimension).toBe('kill_switch');
      expect(decision.checks[0].dimension).toBe('kill_switch'); // declared FIRST in the check order
      expect(decision.checks[0].outcome).toBe('fail');
    }
  });
});

describe('L8: the order-lane intake and lifecycle refuse un-authorized authority', () => {
  it('the intake refuses a fabricated decision object (not even an xd: id)', () => {
    const intake = acceptExecutionIntakeMirror(
      { decision: { kind: 'approve', decisionId: 'self-minted' }, intent: realIntent, killSwitch: killSwitchStanding, limitStates: [], directorDecision: null },
      { tenant: REFERENCE_SCENARIO.tenant, project: REFERENCE_SCENARIO.project },
      REFERENCE_SCENARIO.instants.orderClockBase + 1,
    );
    expect(intake.ok).toBe(false);
    if (!intake.ok) {
      expect(intake.errors.some((error) => error.code === 'decision_not_approved')).toBe(true);
    }
  });

  it('preparation with a non-xd: ref is the typed decision_not_approved', () => {
    const prepared = prepareOrderMirror({
      decisionRef: 'gwr-not-a-decision',
      decisionAsOf: REFERENCE_SCENARIO.instants.decisionAsOf,
      intentRef: realIntent.intentId,
      directorDecision: null,
      orderRef: 'gate-1',
      venue: 'REFSIM',
      instrument: realIntent.order.instrumentId,
      side: 'buy',
      orderKind: 'limit',
      quantity: '0.5',
      orderClock: REFERENCE_SCENARIO.instants.orderClockBase + 1,
      methodId: 'method/execution/order-preparation',
      methodVersion: '1.0.0',
      tenant: REFERENCE_SCENARIO.tenant,
      project: REFERENCE_SCENARIO.project,
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.errors.some((error) => error.code === 'decision_not_approved')).toBe(true);
    }
  });

  it('submission under a THROWN switch fails closed with the typed killswitch_thrown', () => {
    const prepared = prepareOrderMirror({
      decisionRef: realApprove.decisionId,
      decisionAsOf: realApprove.asOf,
      intentRef: realIntent.intentId,
      directorDecision: null,
      orderRef: 'gate-2',
      venue: 'REFSIM',
      instrument: realIntent.order.instrumentId,
      side: 'buy',
      orderKind: 'limit',
      quantity: '0.5',
      orderClock: REFERENCE_SCENARIO.instants.orderClockBase + 1,
      methodId: 'method/execution/order-preparation',
      methodVersion: '1.0.0',
      tenant: REFERENCE_SCENARIO.tenant,
      project: REFERENCE_SCENARIO.project,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const submitted = appendOrderLifecycleEventMirror(prepared.value, {
      event: 'submit',
      orderClock: REFERENCE_SCENARIO.instants.orderClockBase + 2,
      methodId: 'method/execution/order-preparation',
      methodVersion: '1.0.0',
      killSwitch: { state: 'thrown' },
    });
    expect(submitted.ok).toBe(false);
    if (!submitted.ok) {
      expect(submitted.errors.some((error) => error.code === 'killswitch_thrown')).toBe(true);
    }
  });
});

describe('L8/L20: the body law refuses model-autonomous execution authority', () => {
  it('a body granting EXECUTE without external-gateway-only carries the typed execution_authority_granted violation', () => {
    const executionBody = run.stages.bodies.bodies.find((body) => body.bodyId === 'execution') as BodyVersionMirror;
    const rogue = {
      ...executionBody.composition.authorityBoundary,
      allowedActions: [...executionBody.composition.authorityBoundary.allowedActions, 'EXECUTE' as const],
      executionAuthority: 'none' as const, // EXECUTE allowed but no external gateway — the L8 crime
    };
    const violations = authorityViolationsOf(rogue);
    expect(violations).toContain('execution_authority_granted');
  });

  it('a body with NO execution authority must explicitly prohibit EXECUTE', () => {
    const directorBody = run.stages.bodies.bodies.find((body) => body.bodyId === 'trading-director') as BodyVersionMirror;
    const boundary = directorBody.composition.authorityBoundary;
    expect(boundary.executionAuthority).toBe('none');
    expect(authorityViolationsOf(boundary)).toEqual([]); // the lawful spec passes
    const stripped = { ...boundary, prohibitedActions: [] }; // EXECUTE not prohibited — the typed crime
    expect(authorityViolationsOf(stripped)).toContain('execute_not_prohibited');
  });

  it('the execution body\'s EXECUTE action pairs with external-gateway-only (the REQUEST mode)', () => {
    const executionBody = run.stages.bodies.bodies.find((body) => body.bodyId === 'execution') as BodyVersionMirror;
    const boundary = executionBody.composition.authorityBoundary;
    expect(boundary.allowedActions).toContain('EXECUTE');
    expect(boundary.executionAuthority).toBe('external-gateway-only'); // EXECUTE = gateway REQUEST semantics
    expect(authorityViolationsOf(boundary)).toEqual([]);
  });
});

describe('L8 evidence from the reference run: the refused intent NEVER reached a venue', () => {
  it('the SOL-USD refusal produced zero engine fills, zero lifecycle records and a refused outcome', () => {
    // Engine fills: BTC + ETH only — SOL never touched an engine.
    expect(run.stages.execution.engineFills.map((fill) => fill.instrument).sort()).toEqual(['BTC-USD', 'ETH-USD']);
    // Lifecycle logs: one per APPROVED decision only.
    expect(run.stages.execution.logs).toHaveLength(2);
    // The refused submission and its audit record (one record per decision, order: null).
    const refusedAudit = run.stages.riskGateway.auditRecords.find((record) => record.outcome === 'refused');
    expect(refusedAudit?.order).toBeNull();
    expect(refusedAudit?.execution).toBeNull();
    // The refused outcome carries the refusal ref and no fills.
    const refusedOutcome = run.stages.outcomes.outcomeLog.records.find((record) => record.disposition === 'refused');
    expect(refusedOutcome?.fills).toEqual([]);
    expect(refusedOutcome?.refusalRef).toMatch(/^swr:/);
  });
});
