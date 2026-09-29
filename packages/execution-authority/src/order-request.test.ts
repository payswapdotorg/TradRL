// @tradrl/execution-authority — the GatewayOrderRequest tests: the
// TRANSLATION CONTRACT's existential law. An order request without a
// valid approved decision is INEXPRESSIBLE at the guard level; the
// builder's refusal order (opacity first, then the approve law, then
// the form/ref/switch/coherence laws); content-addressed determinism.

import { describe, expect, it } from 'vitest';

import {
  canonicalOrderRequestJson,
  gatewayOrderRequest,
  isGatewayOrderRequest,
  isKillSwitchStandingFact,
  mintApproveDecisionId,
  type GatewayOrderRequest,
  type GatewayOrderRequestInput,
} from './index';
import { CRED_BROKER, fixtureApproveDecision, fixtureOrderForm, T0 } from './test-fixtures';

/** The well-formed builder input (the happy path). */
function wellFormedInput(): {
  readonly decision: unknown;
  readonly order: unknown;
  readonly route: unknown;
  readonly grantRef: unknown;
  readonly credentialRef: unknown;
  readonly kill_switch: unknown;
  readonly asOf: unknown;
} {
  return {
    decision: fixtureApproveDecision(),
    order: fixtureOrderForm(),
    route: { venue: 'BROKER-FIX', adapterRef: 'adapter:adapter-brokers@0.0.0', channelRef: 'chan:newOrderSingle' },
    grantRef: 'grant:gateway-execute-limit@1',
    credentialRef: CRED_BROKER,
    kill_switch: { state: 'standing' },
    asOf: T0,
  };
}

describe('the translation contract (GatewayOrderRequest)', () => {
  it('the happy path builds a guard-valid, deeply deterministic request', () => {
    const result = gatewayOrderRequest(wellFormedInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const request: GatewayOrderRequest = result.value;
    expect(isGatewayOrderRequest(request)).toBe(true);
    expect(request.requestRef.startsWith('gor:')).toBe(true);
    expect(request.killSwitchStanding).toBe('standing');
    // Determinism: the same input byte-identically rebuilds.
    const again = gatewayOrderRequest(wellFormedInput());
    expect(again.ok).toBe(true);
    if (again.ok) expect(canonicalOrderRequestJson(again.value)).toBe(canonicalOrderRequestJson(request));
  });

  it('THE EXISTENTIAL LAW: a REFUSAL decision is decision_not_approved — a refusal is a record, never authority', () => {
    const refusalDecision = {
      ...fixtureApproveDecision(),
      kind: 'refuse',
      decisionId: 'xd:t040fx02',
      failure: { dimension: 'limits', ordinal: 4, reason: { dimension: 'limits', limit: 'order_size', instrumentClass: 'crypto', cap: '1', observed: '5', excess: '4' } },
    };
    const result = gatewayOrderRequest({ ...wellFormedInput(), decision: refusalDecision });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('decision_not_approved');
  });

  it('THE FORGERY LAW: a valid-shaped but content-mismatched decision id is decision_not_approved (a forged ref is not authority)', () => {
    const forged = { ...fixtureApproveDecision(), decisionId: 'xd:forged000' };
    const result = gatewayOrderRequest({ ...wellFormedInput(), decision: forged });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('decision_not_approved');
    // And a decision whose content was edited WITHOUT re-deriving the id:
    const edited = { ...fixtureApproveDecision(), asOf: T0 + 999 };
    const editedResult = gatewayOrderRequest({ ...wellFormedInput(), decision: edited });
    expect(editedResult.ok).toBe(false);
    if (!editedResult.ok) expect(editedResult.errors[0]?.code).toBe('decision_not_approved');
  });

  it('THE EXISTENTIAL LAW: garbage / malformed / absent decisions are decision_not_approved', () => {
    for (const decision of [null, undefined, 42, 'approve', {}, { kind: 'approve' }]) {
      const result = gatewayOrderRequest({ ...wellFormedInput(), decision });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]?.code).toBe('decision_not_approved');
    }
  });

  it('THE GUARD LEVEL: a record whose decision half is not an approve fails isGatewayOrderRequest', () => {
    const built = gatewayOrderRequest(wellFormedInput());
    if (!built.ok) throw new Error('fixture must build');
    // Swap the decision for a refusal-shaped record: the guard refuses.
    expect(isGatewayOrderRequest({ ...built.value, decision: { kind: 'refuse' } })).toBe(false);
    // And for structurally broken approve records:
    expect(isGatewayOrderRequest({ ...built.value, decision: { ...fixtureApproveDecision(), decisionId: 'not-xd' } })).toBe(false);
    expect(isGatewayOrderRequest({ ...built.value, decision: { ...fixtureApproveDecision(), checks: [{ dimension: 'limits', ordinal: 4, outcome: 'fail' }] } })).toBe(false);
    expect(isGatewayOrderRequest({ ...built.value, decision: { ...fixtureApproveDecision(), lineage: { ...(fixtureApproveDecision().lineage as Record<string, unknown>), venues: [] } } })).toBe(false);
  });

  it('the opacity trip wire runs FIRST over the whole input bundle', () => {
    const contaminated: Record<string, unknown> = { ...wellFormedInput() };
    contaminated.apiKey = 'synthetic-secret-value';
    const result = gatewayOrderRequest(contaminated as unknown as GatewayOrderRequestInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('credential_value_present');
  });

  it('a nested credential VALUE inside the decision\'s lineage is caught (the scan is total)', () => {
    const contaminatedDecision = {
      ...fixtureApproveDecision(),
      lineage: { ...(fixtureApproveDecision().lineage as Record<string, unknown>), secret: 'x' },
    };
    const result = gatewayOrderRequest({ ...wellFormedInput(), decision: contaminatedDecision });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('credential_value_present');
  });

  it('a THROWN kill switch refuses the build (kill_switch_thrown — the injected fact, honored)', () => {
    const result = gatewayOrderRequest({ ...wellFormedInput(), kill_switch: { state: 'thrown' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('kill_switch_thrown');
  });

  it('a malformed kill-switch fact is a typed invalid_field', () => {
    const result = gatewayOrderRequest({ ...wellFormedInput(), kill_switch: { state: 'maybe' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_field');
    expect(isKillSwitchStandingFact({ state: 'standing' })).toBe(true);
    expect(isKillSwitchStandingFact({ state: 'thrown' })).toBe(true);
    expect(isKillSwitchStandingFact({ state: 'nope' })).toBe(false);
  });

  it('the COHERENCE laws: the order\'s venue must BE the routed venue', () => {
    const mismatchedOrder = { ...fixtureOrderForm(), venueId: 'OMS-EMS' };
    const result = gatewayOrderRequest({ ...wellFormedInput(), order: mismatchedOrder });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('request_incoherent');
  });

  it('the COHERENCE laws: the decision\'s lineage must name the routed venue (with a re-derived id — content stays addressed)', () => {
    const mismatchedContent = {
      ...(fixtureApproveDecision() as Record<string, unknown>),
      lineage: { ...(fixtureApproveDecision().lineage as Record<string, unknown>), venues: ['OMS-EMS'] },
    };
    const { decisionId, ...rest } = mismatchedContent as unknown as { decisionId: string } & Record<string, unknown>;
    void decisionId;
    const mismatchedDecision = { ...rest, decisionId: mintApproveDecisionId(rest as never) };
    const result = gatewayOrderRequest({ ...wellFormedInput(), decision: mismatchedDecision });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('request_incoherent');
  });

  it('malformed refs (grant/credential/route) are typed invalid_field refusals', () => {
    const badGrant = gatewayOrderRequest({ ...wellFormedInput(), grantRef: 'not-a-grant-ref' });
    expect(badGrant.ok).toBe(false);
    if (!badGrant.ok) expect(badGrant.errors[0]?.code).toBe('invalid_field');

    const badCred = gatewayOrderRequest({ ...wellFormedInput(), credentialRef: 'secret-value' });
    expect(badCred.ok).toBe(false);
    if (!badCred.ok) expect(badCred.errors[0]?.code).toBe('invalid_field');

    const badRoute = gatewayOrderRequest({ ...wellFormedInput(), route: { venue: 'BROKER-FIX' } });
    expect(badRoute.ok).toBe(false);
    if (!badRoute.ok) expect(badRoute.errors[0]?.code).toBe('invalid_field');
  });

  it('a malformed order form is a typed invalid_field refusal (fail-closed)', () => {
    const badOrder = { ...fixtureOrderForm(), quantity: '0' };
    const result = gatewayOrderRequest({ ...wellFormedInput(), order: badOrder });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_field');
  });
});
