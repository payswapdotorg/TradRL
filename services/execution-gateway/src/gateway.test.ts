// @tradrl/execution_gateway — the gateway behavioral suite: every
// Work-Order-enumerated gate case. The recording fake ports carry the
// zero-transport-calls assertions; the REAL T039 adapters are driven
// through the gateway in interop.test.ts; byte-determinism is
// golden.test.ts.
//
// THE ENUMERATED CASES (the Work Order's gate list):
//   - default-deny for unknown venue/grant/entitlement (zero transport calls each);
//   - kill-switch thrown -> every submission refuses;
//   - credential VALUE anywhere in any submitted/emitted record -> typed
//     credential_value_present (the trip wire over the whole request bundle);
//   - replayed DecisionId -> duplicate_decision;
//   - grant validity window at exact equality (BOTH sides + off-by-one ms);
//   - cross-tenant grant reuse -> typed error;
//   - shadow-mode intent -> typed refusal;
//   - audit chain tamper detection (mutate a byte -> verification fails);
//   - rate budget off-by-one (the request at exactly the budget passes, the next refuses);
//   - refusal-at-every-stage produces zero outbound messages;
//   - the no-bypass negatives (direct routing calls, replayed approvals, forged
//     decision refs — typed errors at every owning layer).

import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  credentialValueViolations,
  gatewayOrderRequest,
  isGatewayAuditTrail,
  validateGatewayAuditTrail,
  verifyGatewayAuditChain,
  type GatewayAuditTrail,
} from '../../../packages/execution-authority/src/index';
import { fixtureApproveDecision, fixtureOrderForm } from '../../../packages/execution-authority/src/test-fixtures';
import {
  auditTrailSatisfiesSecuritySentence,
  authorizationFailIntent,
  breachingExposure,
  compliantIntent,
  contaminatedIntent,
  ghostAdapterRoutingTable,
  identityFailIntent,
  limitFailIntent,
  malformedIntent,
  pendingVenueIntent,
  policyWithGhostGrant,
  policyWithoutBrokerCredential,
  rateWindowSaturatedVenueState,
  referenceApproveBatch,
  referenceExposure,
  referenceKillSwitch,
  referencePolicy,
  referencePortfolio,
  referenceRegistry,
  referenceRiskPolicy,
  referenceRoutingTable,
  referenceVenueState,
  shadowModeIntent,
  thrownReferenceKillSwitch,
  unknownVenueIntent,
  unroutedIntent,
  venueFailIntent,
  unroutableRoutingTable,
  T0,
  TENANT,
  PROJECT,
  SUBSTRATE,
  VENUE_BROKER,
} from './fixtures';
import { createExecutionGateway, isGatewayRefusal, recordingPort, scriptedInstants, type ExecutionGatewaySession, type GatewaySubmissionRecord } from './index';

// ---------------------------------------------------------------------------
// The reference gateway builder (the test harness)
// ---------------------------------------------------------------------------

/** The reference gateway over recording fake ports, overridable per test. */
function referenceGateway(overrides: {
  readonly policy?: Parameters<typeof referencePolicy>[];
  readonly killSwitch?: ReturnType<typeof referenceKillSwitch>;
  readonly venueState?: ReturnType<typeof referenceVenueState>;
  readonly exposure?: unknown;
  readonly registry?: ReturnType<typeof referenceRegistry>;
  readonly routing?: ReturnType<typeof referenceRoutingTable>;
  readonly instants?: readonly number[];
  readonly gatewayPolicy?: unknown;
} = {}): { readonly gateway: ExecutionGatewaySession; readonly brokerPort: ReturnType<typeof recordingPort>; readonly omsPort: ReturnType<typeof recordingPort> } {
  const brokerPort = recordingPort();
  const omsPort = recordingPort();
  const construction = createExecutionGateway({
    policy: (overrides.gatewayPolicy ?? referencePolicy()) as never,
    gate: { portfolio: referencePortfolio(), venueState: overrides.venueState ?? referenceVenueState() },
    risk: { policy: referenceRiskPolicy(), exposure: overrides.exposure ?? referenceExposure() },
    authority: overrides.registry ?? referenceRegistry(),
    routing: overrides.routing ?? referenceRoutingTable(),
    adapters: [
      { adapterRef: 'adapter:adapter-brokers@0.0.0' as never, port: brokerPort },
      { adapterRef: 'adapter:adapter-oms-ems@0.0.0' as never, port: omsPort },
    ],
    killSwitch: overrides.killSwitch ?? referenceKillSwitch(),
    instants: scriptedInstants(overrides.instants ?? defaultInstants(20)),
    substrate: SUBSTRATE,
  });
  if (!construction.ok) {
    throw new Error(`the reference gateway must construct: ${JSON.stringify(construction.errors)}`);
  }
  return { gateway: construction.gateway, brokerPort, omsPort };
}

/** Deterministic submission instants (one per submission, 1s apart). */
function defaultInstants(count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => T0 + index * 1_000);
}

/** Unwrap a submission result or fail loudly. */
function submissionOf(result: { readonly ok: true; readonly value: GatewaySubmissionRecord } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): GatewaySubmissionRecord {
  if (result.ok) return result.value;
  throw new Error(`the submission must produce an outcome: ${JSON.stringify(result.errors)}`);
}

// ---------------------------------------------------------------------------
// The golden path (the approve batch routes both lanes)
// ---------------------------------------------------------------------------

describe('the golden path: the approve batch routes both adapter lanes', () => {
  it('three compliant intents route: two through the brokers lane, one through the OMS/EMS lane', () => {
    const { gateway, brokerPort, omsPort } = referenceGateway();
    const outcomes = referenceApproveBatch().map((anIntent) => submissionOf(gateway.submitDecision(anIntent)));
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['routed', 'routed', 'routed']);
    expect(brokerPort.calls().length).toBe(2);
    expect(omsPort.calls().length).toBe(1);
    // The routing bundles carry the opaque credential refs (never values).
    for (const bundle of [...brokerPort.calls(), ...omsPort.calls()]) {
      expect(typeof bundle.credential_ref === 'string' && (bundle.credential_ref as string).startsWith('cred:')).toBe(true);
      expect(credentialValueViolations(bundle)).toEqual([]);
    }
  });

  it('every submission emits EXACTLY ONE audit record; the trail chain-verifies; the session is coherent', () => {
    const { gateway } = referenceGateway();
    referenceApproveBatch().forEach((anIntent) => gateway.submitDecision(anIntent));
    const trail = gateway.auditTrail();
    expect(trail.records.length).toBe(3);
    expect(isGatewayAuditTrail(trail)).toBe(true);
    expect(verifyGatewayAuditChain(trail).ok).toBe(true);
    expect(gateway.verifyGatewayCoherence().ok).toBe(true);
    expect(gateway.submissions().length).toBe(3);
  });

  it('the audit records carry SECURITY.md\'s full sentence (who/what, BodyVersion, substrate, policy, visible state, risk checks, order, execution, outcome)', () => {
    const { gateway } = referenceGateway();
    referenceApproveBatch().forEach((anIntent) => gateway.submitDecision(anIntent));
    for (const record of gateway.auditTrail().records) {
      const sentence = auditTrailSatisfiesSecuritySentence(record);
      expect(sentence.errors).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Default-Deny (unknown venue / unknown grant / missing entitlement) — zero
// transport calls each
// ---------------------------------------------------------------------------

describe('the Default-Deny law (nothing routes by default)', () => {
  it('UNKNOWN VENUE: a policy-covered but registry-absent venue is the typed unknown_venue refusal — zero transport calls', () => {
    const { gateway, brokerPort, omsPort } = referenceGateway();
    const outcome = submissionOf(gateway.submitDecision(pendingVenueIntent()));
    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') {
      expect(outcome.refusal.stage).toBe('entitlement');
      expect((outcome.refusal as { refusal: { kind: string } }).refusal.kind).toBe('unknown_venue');
    }
    expect(brokerPort.calls().length).toBe(0);
    expect(omsPort.calls().length).toBe(0);
  });

  it('UNKNOWN GRANT: a policy-declared scope ref with no registry record is the typed unknown_grant refusal — zero transport calls', () => {
    const { gateway, brokerPort, omsPort } = referenceGateway({ gatewayPolicy: policyWithGhostGrant() });
    const outcome = submissionOf(gateway.submitDecision(compliantIntent()));
    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') {
      expect(outcome.refusal.stage).toBe('authority_grant');
      expect((outcome.refusal as { refusal: { kind: string } }).refusal.kind).toBe('unknown_grant');
    }
    expect(brokerPort.calls().length + omsPort.calls().length).toBe(0);
  });

  it('MISSING ENTITLEMENT (credential): a registry variant whose grants omit the venue binding is the typed refusal — zero transport calls', () => {
    // Grants that bind NO credential at BROKER-FIX: the entitlement stage refuses.
    const registry = referenceRegistry(
      [
        { scopeRef: 'grant:gateway-execute-limit@1', orderKinds: ['limit'], credentials: [] },
        { scopeRef: 'grant:gateway-execute-market@1', orderKinds: ['market'], credentials: [] },
      ],
    );
    const { gateway, brokerPort } = referenceGateway({ registry });
    const outcome = submissionOf(gateway.submitDecision(compliantIntent()));
    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') {
      expect(outcome.refusal.stage).toBe('entitlement');
      expect((outcome.refusal as { refusal: { kind: string; subject?: string } }).refusal.kind).toBe('missing_entitlement');
      expect((outcome.refusal as { refusal: { subject?: string } }).refusal.subject).toBe('credential');
    }
    expect(brokerPort.calls().length).toBe(0);
  });

  it('MISSING RATE BUDGET: a grant variant with no budget for the venue is the typed fail-closed refusal', () => {
    const registry = referenceRegistry(
      [
        { scopeRef: 'grant:gateway-execute-limit@1', orderKinds: ['limit'], rateBudgets: [{ venue: VENUE_BROKER, windowMs: 60_000, maxOrders: 0 }] },
        { scopeRef: 'grant:gateway-execute-market@1', orderKinds: ['market'], rateBudgets: [] },
      ],
    );
    const { gateway, brokerPort } = referenceGateway({ registry });
    const outcome = submissionOf(gateway.submitDecision(compliantIntent()));
    // maxOrders 0: the FIRST submission already exceeds (projected 1 > 0).
    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') {
      expect(outcome.refusal.stage).toBe('rate_budget');
      expect((outcome.refusal as { budget: number }).budget).toBe(0);
    }
    expect(brokerPort.calls().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The kill switch (thrown -> every submission refuses)
// ---------------------------------------------------------------------------

describe('the standing kill switch (L8 dominance)', () => {
  it('a THROWN switch refuses EVERY submission (compliant and non-compliant intents alike) — zero transport calls', () => {
    const { gateway, brokerPort, omsPort } = referenceGateway({ killSwitch: thrownReferenceKillSwitch() });
    const intents = [...referenceApproveBatch(), compliantIntent(11), identityFailIntent()];
    for (const anIntent of intents) {
      const outcome = submissionOf(gateway.submitDecision(anIntent));
      expect(outcome.kind).toBe('refused');
      if (outcome.kind === 'refused') {
        // The T019 gate refuses FIRST (kill switch dominance in the declared
        // check order): every refusal is a policy_gate refusal whose failing
        // dimension is kill_switch.
        expect(outcome.refusal.stage).toBe('policy_gate');
        const failure = (outcome.refusal as { decision: { failure?: { dimension?: string } } }).decision.failure;
        expect(failure?.dimension).toBe('kill_switch');
      }
    }
    expect(brokerPort.calls().length + omsPort.calls().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The credential-opacity trip wire over the whole request bundle
// ---------------------------------------------------------------------------

describe('the credential-opacity trip wire (SECURITY.md\'s boundary, enforced in code)', () => {
  it('a credential VALUE anywhere in the SUBMITTED intent is the typed credential_value_present refusal — zero transport calls', () => {
    const { gateway, brokerPort } = referenceGateway();
    const outcome = submissionOf(gateway.submitDecision(contaminatedIntent()));
    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') {
      expect(outcome.refusal.stage).toBe('credential_opacity');
      expect((outcome.refusal as { violations: readonly string[] }).violations).toEqual(['apiKey']);
    }
    expect(brokerPort.calls().length).toBe(0);
  });

  it('the EMITTED records stay clean: the trip wire over the whole audit trail and outcome log finds NOTHING', () => {
    const { gateway } = referenceGateway();
    // A contaminated submission plus a clean one.
    gateway.submitDecision(contaminatedIntent());
    gateway.submitDecision(compliantIntent());
    const trail: GatewayAuditTrail = gateway.auditTrail();
    expect(credentialValueViolations(trail)).toEqual([]);
    expect(credentialValueViolations(gateway.submissions() as unknown[])).toEqual([]);
    // The audit record for the contaminated submission records the refusal
    // WITHOUT embedding the value (the violations list carries the PATH only).
    const first = trail.records[0];
    if (first === undefined) throw new Error('the audit record must exist');
    expect(first.refusal?.stage).toBe('credential_opacity');
    expect(first.outcome).toBe('refused');
  });

  it('a credential VALUE smuggled DEEP inside the intent tree is caught (the scan is total)', () => {
    const { gateway, brokerPort } = referenceGateway();
    const smuggled = {
      ...compliantIntent(12),
      rationale: { ...compliantIntent(12).rationale, deep: { nested: [{ passphrase: 'hunter2' }] } },
    } as unknown as Record<string, unknown>;
    const outcome = submissionOf(gateway.submitDecision(smuggled));
    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') expect(outcome.refusal.stage).toBe('credential_opacity');
    expect(brokerPort.calls().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Approval replay (the same DecisionId submitted twice)
// ---------------------------------------------------------------------------

describe('approval replay (one decision, one submission)', () => {
  it('the same DecisionId submitted twice -> the typed duplicate_decision refusal; THE FIRST STANDS', () => {
    const { gateway, brokerPort } = referenceGateway();
    const first = submissionOf(gateway.submitDecision(referenceApproveBatch()[0]));
    expect(first.kind).toBe('routed');
    // The identical intent resubmitted: the gate re-decides deterministically
    // (the SAME content-addressed DecisionId) and the gateway refuses the replay.
    const second = submissionOf(gateway.submitDecision(referenceApproveBatch()[0]));
    expect(second.kind).toBe('refused');
    if (second.kind === 'refused') {
      expect(second.refusal.stage).toBe('duplicate_decision');
      if (second.refusal.stage === 'duplicate_decision') {
        expect(second.refusal.decisionId).toBe(first.kind === 'routed' ? first.decisionId : '');
      }
    }
    // The first stands: exactly ONE adapter call.
    expect(brokerPort.calls().length).toBe(1);
    // And the trail holds both records without a rewrite (the replay's audit
    // entry carries a NULL decision id — one decision, one audit record).
    expect(gateway.auditTrail().records.length).toBe(2);
    expect(gateway.verifyGatewayCoherence().ok).toBe(true);
  });

  it('a REFUSED-then-resubmitted decision is also a replay (the refusal was audited; the audit law holds)', () => {
    const { gateway } = referenceGateway({ exposure: breachingExposure() });
    const first = submissionOf(gateway.submitDecision(compliantIntent()));
    expect(first.kind).toBe('refused');
    const second = submissionOf(gateway.submitDecision(compliantIntent()));
    expect(second.kind).toBe('refused');
    if (second.kind === 'refused') expect(second.refusal.stage).toBe('duplicate_decision');
    expect(gateway.verifyGatewayCoherence().ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The grant validity window ([issuedAt, expiresAt) — BOTH sides + off-by-one)
// ---------------------------------------------------------------------------

describe('the grant validity window (declared semantics: [issuedAt, expiresAt))', () => {
  it('now === expiresAt -> EXPIRED (the boundary instant belongs to the dead side)', () => {
    const expiresAt = T0 + 2_000;
    const registry = referenceRegistry([{ scopeRef: 'grant:gateway-execute-limit@1', orderKinds: ['limit'], expiresAt }]);
    const { gateway, brokerPort } = referenceGateway({ registry, instants: [expiresAt] });
    const outcome = submissionOf(gateway.submitDecision(compliantIntent()));
    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') {
      expect(outcome.refusal.stage).toBe('authority_grant');
      expect((outcome.refusal as { refusal: { kind: string } }).refusal.kind).toBe('grant_expired');
    }
    expect(brokerPort.calls().length).toBe(0);
  });

  it('now === expiresAt - 1 -> VALID (the last live instant routes)', () => {
    const expiresAt = T0 + 2_000;
    const registry = referenceRegistry([{ scopeRef: 'grant:gateway-execute-limit@1', orderKinds: ['limit'], expiresAt }]);
    const { gateway, brokerPort } = referenceGateway({ registry, instants: [expiresAt - 1] });
    const outcome = submissionOf(gateway.submitDecision(compliantIntent()));
    expect(outcome.kind).toBe('routed');
    expect(brokerPort.calls().length).toBe(1);
  });

  it('now === expiresAt + 1 -> EXPIRED (the off-by-one on the closing side)', () => {
    const expiresAt = T0 + 2_000;
    const registry = referenceRegistry([{ scopeRef: 'grant:gateway-execute-limit@1', orderKinds: ['limit'], expiresAt }]);
    const { gateway } = referenceGateway({ registry, instants: [expiresAt + 1] });
    const outcome = submissionOf(gateway.submitDecision(compliantIntent()));
    if (outcome.kind === 'refused') {
      expect((outcome.refusal as { refusal: { kind: string } }).refusal.kind).toBe('grant_expired');
    } else {
      throw new Error('the off-by-one expiry must refuse');
    }
  });

  it('now === issuedAt -> VALID (the window opens inclusively); now === issuedAt - 1 -> NOT-YET-VALID', () => {
    const issuedAt = T0 + 2_000;
    // The opening side: one instant before issuance refuses...
    const before = referenceRegistry([{ scopeRef: 'grant:gateway-execute-limit@1', orderKinds: ['limit'], issuedAt }]);
    const gatewayBefore = referenceGateway({ registry: before, instants: [issuedAt - 1] });
    const outcomeBefore = submissionOf(gatewayBefore.gateway.submitDecision(compliantIntent()));
    expect(outcomeBefore.kind).toBe('refused');
    if (outcomeBefore.kind === 'refused') {
      expect((outcomeBefore.refusal as { refusal: { kind: string } }).refusal.kind).toBe('grant_not_yet_valid');
    }
    // ...the boundary instant itself routes.
    const atBoundary = referenceRegistry([{ scopeRef: 'grant:gateway-execute-limit@1', orderKinds: ['limit'], issuedAt }]);
    const gatewayAt = referenceGateway({ registry: atBoundary, instants: [issuedAt] });
    const outcomeAt = submissionOf(gatewayAt.gateway.submitDecision(compliantIntent()));
    expect(outcomeAt.kind).toBe('routed');
  });

  it('a REVOKED grant refuses every submission (revocation dominates the window)', () => {
    const registry = referenceRegistry([
      {
        scopeRef: 'grant:gateway-execute-limit@1',
        orderKinds: ['limit'],
        revocations: [{ revokedAt: T0 - 1_000, reason: 'desk policy: principal reassigned', revokedBy: 'principal:risk-desk' }],
      },
    ]);
    const { gateway, brokerPort } = referenceGateway({ registry });
    const outcome = submissionOf(gateway.submitDecision(compliantIntent()));
    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') {
      expect((outcome.refusal as { refusal: { kind: string } }).refusal.kind).toBe('grant_revoked');
    }
    expect(brokerPort.calls().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant grant reuse (the typed construction error)
// ---------------------------------------------------------------------------

describe('cross-tenant grant reuse (L12)', () => {
  it('a gateway whose registry scope disagrees with the policy scope is a TYPED CONSTRUCTION ERROR (inexpressible)', () => {
    const brokerPort = recordingPort();
    const construction = createExecutionGateway({
      policy: referencePolicy(),
      gate: { portfolio: referencePortfolio(), venueState: referenceVenueState() },
      risk: { policy: referenceRiskPolicy(), exposure: referenceExposure() },
      authority: referenceRegistry([], [VENUE_BROKER, 'OMS-EMS', 'VENUE-PENDING']) as never & { tenant: 'tenant-other' },
      routing: referenceRoutingTable(),
      adapters: [{ adapterRef: 'adapter:adapter-brokers@0.0.0' as never, port: brokerPort }],
      killSwitch: referenceKillSwitch(),
      instants: scriptedInstants(defaultInstants(1)),
      substrate: SUBSTRATE,
    });
    // The registry here still carries the reference scope — the coercion above
    // only types it; the REAL cross-tenant case is a registry from ANOTHER
    // tenant, which the registry validator itself rejects. The construction
    // law is proven with a genuinely foreign registry below.
    expect(construction.ok).toBe(true); // the same-scope registry constructs
    // The genuinely foreign registry: tenant-other.
    const foreign = (() => {
      const foreignRegistry = referenceRegistry();
      return { ...foreignRegistry, tenant: 'tenant-other' };
    })();
    const constructionForeign = createExecutionGateway({
      policy: referencePolicy(),
      gate: { portfolio: referencePortfolio(), venueState: referenceVenueState() },
      risk: { policy: referenceRiskPolicy(), exposure: referenceExposure() },
      authority: foreign,
      routing: referenceRoutingTable(),
      adapters: [{ adapterRef: 'adapter:adapter-brokers@0.0.0' as never, port: brokerPort }],
      killSwitch: referenceKillSwitch(),
      instants: scriptedInstants(defaultInstants(1)),
      substrate: SUBSTRATE,
    });
    expect(constructionForeign.ok).toBe(false);
    if (!constructionForeign.ok) {
      expect(constructionForeign.errors.some((error) => error.code === 'tenant_missing')).toBe(true);
    }
    expect(brokerPort.calls().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Shadow-mode separation (the consequential lane refuses the paper lane)
// ---------------------------------------------------------------------------

describe('shadow-mode separation (the consequential lane)', () => {
  it('a SHADOW-mode intent reaching the live gateway is the typed shadow_mode refusal — zero transport calls', () => {
    const { gateway, brokerPort } = referenceGateway();
    const outcome = submissionOf(gateway.submitDecision(shadowModeIntent('shadow')));
    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') {
      expect(outcome.refusal.stage).toBe('shadow_mode');
      expect((outcome.refusal as { mode: string }).mode).toBe('shadow');
    }
    expect(brokerPort.calls().length).toBe(0);
  });

  it('a PAPER-mode intent is refused identically (both non-live markers)', () => {
    const { gateway, brokerPort } = referenceGateway();
    const outcome = submissionOf(gateway.submitDecision(shadowModeIntent('paper')));
    if (outcome.kind === 'refused') {
      expect(outcome.refusal.stage).toBe('shadow_mode');
      expect((outcome.refusal as { mode: string }).mode).toBe('paper');
    } else {
      throw new Error('the paper-mode intent must refuse');
    }
    expect(brokerPort.calls().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Audit chain tamper detection
// ---------------------------------------------------------------------------

describe('audit chain tamper detection (the append-only discipline)', () => {
  it('mutating a byte of a serialized trail -> the chain verification FAILS (audit_rewrite)', () => {
    const { gateway } = referenceGateway();
    referenceApproveBatch().forEach((anIntent) => gateway.submitDecision(anIntent));
    const pristine = gateway.auditTrail();
    // Serialize, mutate ONE byte of the SECOND record's visible reference price
    // (50000.00 -> 49999.99 — a byte-level edit), re-parse, verify.
    const serialized = JSON.stringify(pristine, null, 0);
    const tamperedText = serialized.replace('50000.00', '49999.99');
    expect(tamperedText).not.toBe(serialized); // the mutation really happened
    const tampered = JSON.parse(tamperedText) as unknown;
    const validated = validateGatewayAuditTrail(tampered);
    expect(validated.ok).toBe(false);
    if (!validated.ok) expect(validated.errors[0]?.code).toBe('audit_rewrite');
    // The pristine trail still verifies (the mutation touched only the copy).
    expect(verifyGatewayAuditChain(pristine).ok).toBe(true);
  });

  it('the session-level coherence check binds the trail to the outcome log (the tail-truncation anchor)', () => {
    const { gateway } = referenceGateway();
    referenceApproveBatch().forEach((anIntent) => gateway.submitDecision(anIntent));
    expect(gateway.verifyGatewayCoherence().ok).toBe(true);
    // The trail's records ARE in 1:1 correspondence with the submissions.
    expect(gateway.auditTrail().records.length).toBe(gateway.submissions().length);
  });
});

// ---------------------------------------------------------------------------
// The rate budget off-by-one (the request at exactly the budget passes)
// ---------------------------------------------------------------------------

describe('the rate budget off-by-one (the grant\'s per-venue window)', () => {
  /** A tight-budget gateway: maxOrders 3 per 60s window on BROKER-FIX. */
  function tightGateway(instants: readonly number[]): { readonly gateway: ExecutionGatewaySession; readonly brokerPort: ReturnType<typeof recordingPort> } {
    const registry = referenceRegistry([
      { scopeRef: 'grant:gateway-execute-limit@1', orderKinds: ['limit'], rateBudgets: [{ venue: VENUE_BROKER, windowMs: 60_000, maxOrders: 3 }] },
      { scopeRef: 'grant:gateway-execute-market@1', orderKinds: ['market'], rateBudgets: [] },
    ]);
    return referenceGateway({ registry, instants });
  }

  it('the request at EXACTLY the budget passes; the NEXT refuses (off-by-one)', () => {
    const { gateway, brokerPort } = tightGateway([T0, T0 + 1_000, T0 + 2_000, T0 + 3_000]);
    const intents = [compliantIntent(21), compliantIntent(22), compliantIntent(23), compliantIntent(24)];
    const outcomes = intents.map((anIntent) => submissionOf(gateway.submitDecision(anIntent)));
    // Requests 1..3 (the budget) route; request 4 (budget + 1) refuses.
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['routed', 'routed', 'routed', 'refused']);
    if (outcomes[3] && outcomes[3].kind === 'refused') {
      expect(outcomes[3].refusal.stage).toBe('rate_budget');
      const refusal = outcomes[3].refusal as { budget: number; observed: number; windowMs: number };
      expect(refusal.budget).toBe(3);
      expect(refusal.observed).toBe(3);
      expect(refusal.windowMs).toBe(60_000);
    }
    expect(brokerPort.calls().length).toBe(3);
  });

  it('the window ROLLS: after windowMs the budget resets (the threading law)', () => {
    const { gateway, brokerPort } = tightGateway([T0, T0 + 1_000, T0 + 2_000, T0 + 61_000]);
    const intents = [compliantIntent(25), compliantIntent(26), compliantIntent(27), compliantIntent(28)];
    const outcomes = intents.map((anIntent) => submissionOf(gateway.submitDecision(anIntent)));
    // The fourth submission lands in a NEW window -> routes again.
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['routed', 'routed', 'routed', 'routed']);
    expect(brokerPort.calls().length).toBe(4);
  });

  it('the rate state snapshot is deterministic and readable', () => {
    const { gateway } = tightGateway([T0, T0 + 1_000]);
    gateway.submitDecision(compliantIntent(29));
    gateway.submitDecision(compliantIntent(30));
    expect(gateway.rateState()).toEqual([{ venue: VENUE_BROKER, anchor: T0, count: 2 }]);
  });
});

// ---------------------------------------------------------------------------
// Refusal at EVERY stage produces zero outbound messages (the sweep)
// ---------------------------------------------------------------------------

describe('refusal at every stage produces ZERO outbound messages (the no-bypass sweep)', () => {
  /** One refusal scenario: name, the gateway factory, the intent, the expected stage. */
  interface Scenario {
    readonly name: string;
    readonly build: () => { readonly gateway: ExecutionGatewaySession; readonly calls: () => number };
    readonly intent: unknown;
    readonly stage: string;
  }

  const scenarios: readonly Scenario[] = [
    {
      name: 'credential_opacity (a contaminated intent)',
      build: () => {
        const harness = referenceGateway();
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: contaminatedIntent(),
      stage: 'credential_opacity',
    },
    {
      name: 'intent_validation (a malformed intent)',
      build: () => {
        const harness = referenceGateway();
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: malformedIntent(),
      stage: 'intent_validation',
    },
    {
      name: 'shadow_mode (a shadow-mode intent)',
      build: () => {
        const harness = referenceGateway();
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: shadowModeIntent(),
      stage: 'shadow_mode',
    },
    {
      name: 'policy_gate: identity (an undeclared principal)',
      build: () => {
        const harness = referenceGateway();
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: identityFailIntent(),
      stage: 'policy_gate',
    },
    {
      name: 'policy_gate: authorization (a stop order no grant permits)',
      build: () => {
        const harness = referenceGateway();
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: authorizationFailIntent(),
      stage: 'policy_gate',
    },
    {
      name: 'policy_gate: limits (a 1.5 BTC order over the cap)',
      build: () => {
        const harness = referenceGateway();
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: limitFailIntent(),
      stage: 'policy_gate',
    },
    {
      name: 'policy_gate: venue permissions (SOL-USDT not allowlisted)',
      build: () => {
        const harness = referenceGateway();
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: venueFailIntent(),
      stage: 'policy_gate',
    },
    {
      name: 'policy_gate: credentials (the venue has no policy binding)',
      build: () => {
        const harness = referenceGateway({ gatewayPolicy: policyWithoutBrokerCredential() });
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: compliantIntent(31),
      stage: 'policy_gate',
    },
    {
      name: 'policy_gate: rate limits (the venue window is saturated)',
      build: () => {
        const harness = referenceGateway({ venueState: rateWindowSaturatedVenueState() });
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: compliantIntent(32),
      stage: 'policy_gate',
    },
    {
      name: 'policy_gate: kill switch (a thrown switch)',
      build: () => {
        const harness = referenceGateway({ killSwitch: thrownReferenceKillSwitch() });
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: compliantIntent(33),
      stage: 'policy_gate',
    },
    {
      name: 'gate_envelope (the venue is absent from the venue state)',
      build: () => {
        const harness = referenceGateway();
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: unknownVenueIntent(),
      stage: 'gate_envelope',
    },
    {
      name: 'risk_limits (a breaching exposure)',
      build: () => {
        const harness = referenceGateway({ exposure: breachingExposure() });
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: compliantIntent(34),
      stage: 'risk_limits',
    },
    {
      name: 'authority_grant: expired (the boundary instant)',
      build: () => {
        const registry = referenceRegistry([{ scopeRef: 'grant:gateway-execute-limit@1', orderKinds: ['limit'], expiresAt: T0 + 500 }]);
        const harness = referenceGateway({ registry, instants: [T0 + 500] });
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: compliantIntent(35),
      stage: 'authority_grant',
    },
    {
      name: 'authority_grant: unknown (a ghost scope ref)',
      build: () => {
        const harness = referenceGateway({ gatewayPolicy: policyWithGhostGrant() });
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: compliantIntent(36),
      stage: 'authority_grant',
    },
    {
      name: 'entitlement: unknown venue (VENUE-PENDING is registry-absent)',
      build: () => {
        const harness = referenceGateway();
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: pendingVenueIntent(),
      stage: 'entitlement',
    },
    {
      name: 'rate_budget (a zero budget)',
      build: () => {
        const registry = referenceRegistry([
          { scopeRef: 'grant:gateway-execute-limit@1', orderKinds: ['limit'], rateBudgets: [{ venue: VENUE_BROKER, windowMs: 60_000, maxOrders: 0 }] },
          { scopeRef: 'grant:gateway-execute-market@1', orderKinds: ['market'], rateBudgets: [] },
        ]);
        const harness = referenceGateway({ registry });
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: compliantIntent(37),
      stage: 'rate_budget',
    },
    {
      name: 'routing: no_route (the permitted-but-unrouted pair)',
      build: () => {
        const harness = referenceGateway({ routing: unroutableRoutingTable() });
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: unroutedIntent(),
      stage: 'routing',
    },
    {
      name: 'routing: no_adapter (the ghost adapter ref)',
      build: () => {
        const harness = referenceGateway({ routing: ghostAdapterRoutingTable() });
        return { gateway: harness.gateway, calls: () => harness.brokerPort.calls().length + harness.omsPort.calls().length };
      },
      intent: compliantIntent(38),
      stage: 'routing',
    },
    {
      name: 'adapter (the injected port\'s typed refusal — still zero SENT messages)',
      build: () => {
        const brokerPort = recordingPort([{ atCall: 0, kind: 'protocol', code: 'decision_not_approved', message: 'the scripted adapter refusal fixture' }]);
        const construction = createExecutionGateway({
          policy: referencePolicy(),
          gate: { portfolio: referencePortfolio(), venueState: referenceVenueState() },
          risk: { policy: referenceRiskPolicy(), exposure: referenceExposure() },
          authority: referenceRegistry(),
          routing: referenceRoutingTable(),
          adapters: [{ adapterRef: 'adapter:adapter-brokers@0.0.0' as never, port: brokerPort }],
          killSwitch: referenceKillSwitch(),
          instants: scriptedInstants([T0]),
          substrate: SUBSTRATE,
        });
        if (!construction.ok) throw new Error(JSON.stringify(construction.errors));
        return { gateway: construction.gateway, calls: () => brokerPort.calls().length };
      },
      intent: compliantIntent(39),
      stage: 'adapter',
    },
  ];

  for (const scenario of scenarios) {
    it(`${scenario.name} -> stage ${scenario.stage}: refused, ZERO outbound messages, ONE audit record`, () => {
      const { gateway, calls } = scenario.build();
      const outcome = submissionOf(gateway.submitDecision(scenario.intent));
      expect(outcome.kind).toBe('refused');
      if (outcome.kind === 'refused') {
        expect(outcome.refusal.stage).toBe(scenario.stage);
        expect(isGatewayRefusal(outcome.refusal)).toBe(true);
      }
      expect(calls()).toBe(scenario.stage === 'adapter' ? 1 : 0);
      // The adapter-stage refusal is the ONE case where the port was CALLED
      // (by design — the adapter's own L8 checks refused INSIDE the session,
      // before anything was sent); every other stage made ZERO calls.
      expect(gateway.auditTrail().records.length).toBe(1);
      expect(gateway.verifyGatewayCoherence().ok).toBe(true);
    });
  }

  it('the sweep covers every REACHABLE stage of the declared pipeline (the enumerated gate list)', () => {
    // duplicate_decision has its own suite above; kill_switch, risk_envelope
    // and translation are the defense-in-depth stages (unreachable through a
    // validated construction: the gate refuses thrown switches FIRST, the
    // exposure and switch are construction-validated, and the translation
    // inputs are built from already-validated parts) — by design, not by
    // omission.
    const covered = [...new Set(scenarios.map((scenario) => scenario.stage))].sort();
    expect(covered).toEqual(
      [
        'adapter',
        'authority_grant',
        'credential_opacity',
        'entitlement',
        'gate_envelope',
        'intent_validation',
        'policy_gate',
        'rate_budget',
        'risk_limits',
        'routing',
        'shadow_mode',
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// The no-bypass negatives (typed errors at every owning layer)
// ---------------------------------------------------------------------------

describe('the no-bypass negatives (invariant 6 / L8)', () => {
  it('there is NO submitDecision path that routes without the gate: every routed outcome carries a decision id the REAL gate minted', () => {
    const { gateway } = referenceGateway();
    const outcomes = referenceApproveBatch().map((anIntent) => submissionOf(gateway.submitDecision(anIntent)));
    for (const outcome of outcomes) {
      if (outcome.kind !== 'routed') throw new Error('the batch must route');
      expect(outcome.decisionId.startsWith('xd:')).toBe(true);
      expect(outcome.requestRef.startsWith('gor:')).toBe(true);
    }
  });

  it('a FORGED decision id (content-addressing violation) cannot pass the translation contract — the guard refuses it inexpressibly', () => {
    // The translation contract (the authority package's builder) is the typed
    // gate between the pipeline and the adapter call; a forged decision
    // record fails its guard. (The full-stack negative over the REAL adapters
    // is interop.test.ts.)
    const forged = gatewayOrderRequest({
      decision: { ...fixtureApproveDecision(), decisionId: 'xd:forged000' },
      order: fixtureOrderForm(),
      route: { venue: 'BROKER-FIX', adapterRef: 'adapter:adapter-brokers@0.0.0', channelRef: 'chan:newOrderSingle' },
      grantRef: 'grant:gateway-execute-limit@1',
      credentialRef: 'cred:gw-broker-main@1',
      kill_switch: { state: 'standing' },
      asOf: T0,
    });
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.errors[0]?.code).toBe('decision_not_approved');
  });

  it('the gateway\'s own construction refuses malformed configurations (fail-closed at every seam)', () => {
    const brokerPort = recordingPort();
    const base = {
      gate: { portfolio: referencePortfolio(), venueState: referenceVenueState() },
      risk: { policy: referenceRiskPolicy(), exposure: referenceExposure() },
      authority: referenceRegistry(),
      routing: referenceRoutingTable(),
      adapters: [{ adapterRef: 'adapter:adapter-brokers@0.0.0' as never, port: brokerPort }],
      killSwitch: referenceKillSwitch(),
      instants: scriptedInstants([T0]),
      substrate: SUBSTRATE,
    };
    // A malformed policy...
    expect(createExecutionGateway({ ...base, policy: { version: 1 } as never }).ok).toBe(false);
    // A malformed exposure...
    expect(createExecutionGateway({ ...base, policy: referencePolicy(), risk: { policy: referenceRiskPolicy(), exposure: { nonsense: true } } }).ok).toBe(false);
    // A tampered kill switch (a record spliced out)...
    const splicedSwitch = (() => {
      const log = referenceKillSwitch();
      return { ...log, records: [] } as never;
    })();
    expect(createExecutionGateway({ ...base, policy: referencePolicy(), killSwitch: splicedSwitch }).ok).toBe(false);
    // A missing adapter port...
    expect(createExecutionGateway({ ...base, policy: referencePolicy(), adapters: [{ adapterRef: 'adapter:adapter-brokers@0.0.0' as never, port: {} as never }] }).ok).toBe(false);
    expect(brokerPort.calls().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism of the outcome vocabulary
// ---------------------------------------------------------------------------

describe('the outcome vocabulary', () => {
  it('the refusal guard covers the closed stage union', () => {
    expect(isGatewayRefusal({ stage: 'nonsense' })).toBe(false);
    expect(isGatewayRefusal('not-a-record')).toBe(false);
    expect(isGatewayRefusal(null)).toBe(false);
  });

  it('the audit trail is tenant-scoped and canonical-JSON serializable (T041/T043 consumption)', () => {
    const { gateway } = referenceGateway();
    referenceApproveBatch().forEach((anIntent) => gateway.submitDecision(anIntent));
    const trail = gateway.auditTrail();
    expect(trail.tenant).toBe(TENANT);
    expect(trail.project).toBe(PROJECT);
    expect(() => canonicalJson(JSON.parse(JSON.stringify(trail)) as never)).not.toThrow();
    const roundTrip = JSON.parse(JSON.stringify(trail));
    expect(validateGatewayAuditTrail(roundTrip).ok).toBe(true);
  });
});
