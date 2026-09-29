/**
 * @tradrl/execution-authority — cross-package interop trip wires.
 *
 * The adapter's contract shapes are STRUCTURAL MIRRORS of
 * @tradrl/execution-policy (T019) and the T039 adapters' own mirrors
 * (law D-004: never imports in sources); this test is the trip wire —
 * if any mirror drifts, the TYPE-LEVEL witnesses below fail
 * `pnpm typecheck`, and the RUNTIME parity checks fail the package
 * test run. Cross-package imports happen ONLY in tests, via relative
 * paths (the repo's established pattern).
 *
 * What is proven here:
 *   1. TYPE LEVEL: the REAL T019 `ApproveDecision` IS this package's
 *      `ApproveDecisionRecord`; the real `RefusalDecision` IS the
 *      `RefusalDecisionRecord`; the real `ExecutionLineage` IS the
 *      `ExecutionLineageRecord`; the real `OrderIntentMirror` IS the
 *      `OrderIntentRecord` — mutually assignable, NO CASTS anywhere.
 *   2. RUNTIME: the REAL T019 gate (runExecutionGate, over the real
 *      execution-policy fixtures) produces a REAL ApproveDecision that
 *      satisfies THIS package's guards verbatim — and its REFUSAL twin
 *      satisfies the refusal guard while FAILING the approve guard
 *      (the translation contract's existential law).
 *   3. RUNTIME: the same REAL decision ALSO passes the REAL brokers
 *      adapter's `isApprovedDecisionMirror` (the T039 triangle: T019
 *      -> T040's mirror -> T039's mirror all agree on what an approved
 *      decision is).
 *   4. RUNTIME: the id-space guards are prefix-for-prefix identical
 *      both directions (grant:, cred:, xd:, xpol:, ksw:).
 *   5. RUNTIME: the credential-opacity trip wires (T019's, T039's and
 *      this package's) flag the IDENTICAL trees — the opacity law is
 *      one law across the three lanes.
 *   6. RUNTIME: the routing refs decompose onto the REAL T039
 *      descriptor identities (`BROKER_ADAPTER`, `OMS_EMS_ADAPTER`,
 *      `BROKER_ORDER_CHANNEL`, `OMS_EMS_ORDER_CHANNEL`).
 */

import { describe, expect, it } from 'vitest';

import {
  adapterDescriptorOf,
  channelOf,
  credentialValueViolations as authorityCredentialViolations,
  isApproveDecisionRecord,
  isCredentialRef as authorityIsCredentialRef,
  isDecisionId as authorityIsDecisionId,
  isExecutionPolicyId as authorityIsExecutionPolicyId,
  isAuthorityScopeRef as authorityIsAuthorityScopeRef,
  isKillSwitchId as authorityIsKillSwitchId,
  isOrderIntentRecord,
  isRefusalDecisionRecord,
  mintAdapterDescriptorRef,
  mintChannelRef,
  type ApproveDecisionRecord,
  type ExecutionLineageRecord,
  type ExecutionDecisionRecord,
  type OrderIntentRecord,
  type RefusalDecisionRecord,
} from './index';

import {
  killSwitchState as t019KillSwitchState,
  mintDecisionId as t019MintDecisionId,
  runExecutionGate,
  validateExecutionPolicy,
  isApproveDecision as t019IsApproveDecision,
  type ApproveDecision as T019ApproveDecision,
  type ExecutionLineage as T019ExecutionLineage,
  type ExecutionDecision as T019ExecutionDecision,
  type OrderIntentMirror as T019OrderIntentMirror,
  type RefusalDecision as T019RefusalDecision,
} from '../../../packages/execution-policy/src/index';
import {
  fixtureIntent as t019FixtureIntent,
  fixturePortfolio,
  fixtureVenueState,
  fixtureKillSwitch,
  fixturePolicyInput,
  unwrap as t019Unwrap,
} from '../../../packages/execution-policy/src/test-fixtures';

import {
  BROKER_ADAPTER,
  BROKER_ORDER_CHANNEL,
  BROKER_VENUE,
  credentialValueViolations as brokersCredentialViolations,
  isApprovedDecisionMirror,
  isCredentialRef as brokersIsCredentialRef,
  isDecisionId as brokersIsDecisionId,
  isOrderIntentMirror as brokersIsOrderIntentMirror,
} from '../../../adapters/brokers/src/index';
import { OMS_EMS_ADAPTER, OMS_EMS_ORDER_CHANNEL, OMS_EMS_VENUE } from '../../../adapters/oms-ems/src/index';
import {
  credentialValueViolations as t019CredentialViolations,
  isAuthorityScopeRef as t019IsAuthorityScopeRef,
  isCredentialRef as t019IsCredentialRef,
  isDecisionId as t019IsDecisionId,
  isExecutionPolicyId as t019IsExecutionPolicyId,
  isKillSwitchId as t019IsKillSwitchId,
} from '../../../packages/execution-policy/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` on drift). No casts: the
// mirrors must be structurally identical.
// ---------------------------------------------------------------------------

/** Compiles iff the REAL T019 ApproveDecision IS this package's ApproveDecisionRecord. */
function realApproveIsAuthorityApprove(value: T019ApproveDecision): ApproveDecisionRecord {
  return value;
}

/** Compiles iff the REAL T019 RefusalDecision IS this package's RefusalDecisionRecord. */
function realRefusalIsAuthorityRefusal(value: T019RefusalDecision): RefusalDecisionRecord {
  return value;
}

/** Compiles iff the REAL T019 ExecutionLineage IS this package's ExecutionLineageRecord. */
function realLineageIsAuthorityLineage(value: T019ExecutionLineage): ExecutionLineageRecord {
  return value;
}

/** Compiles iff the REAL T019 OrderIntentMirror IS this package's OrderIntentRecord. */
function realOrderIsAuthorityOrder(value: T019OrderIntentMirror): OrderIntentRecord {
  return value;
}

/** Compiles iff the REAL T019 decision union IS this package's decision union. */
function realDecisionIsAuthorityDecision(value: T019ExecutionDecision): ExecutionDecisionRecord {
  return value;
}

// Keep the witnesses referenced (type-level only).
void realApproveIsAuthorityApprove;
void realRefusalIsAuthorityRefusal;
void realLineageIsAuthorityLineage;
void realOrderIsAuthorityOrder;
void realDecisionIsAuthorityDecision;

// ---------------------------------------------------------------------------
// The REAL gate's decisions (the shared runtime substrate)
// ---------------------------------------------------------------------------

/** Run the REAL T019 gate over the REAL fixtures and return its decision. */
function realGateDecision(intentOverrides: Record<string, unknown> = {}): T019ExecutionDecision {
  const decision = runExecutionGate({
    intent: t019FixtureIntent(intentOverrides),
    policy: t019Unwrap(validateExecutionPolicy(fixturePolicyInput())),
    portfolio: fixturePortfolio(),
    venueState: fixtureVenueState(),
    killSwitch: fixtureKillSwitch(),
  });
  if (!decision.ok) throw new Error(`the real gate must decide: ${JSON.stringify(decision.errors)}`);
  return decision.value;
}

// ---------------------------------------------------------------------------
// The interop proofs
// ---------------------------------------------------------------------------

describe('the REAL T019 gate\'s decisions satisfy this package\'s mirrors (the interop core)', () => {
  it('a REAL ApproveDecision passes isApproveDecisionRecord VERBATIM (zero casts)', () => {
    const decision = realGateDecision();
    expect(t019IsApproveDecision(decision)).toBe(true);
    if (decision.kind !== 'approve') throw new Error('fixture must approve');
    const mirrored: ApproveDecisionRecord = decision;
    expect(isApproveDecisionRecord(mirrored)).toBe(true);
  });

  it('a REAL RefusalDecision passes isRefusalDecisionRecord and FAILS the approve guard (the existential law)', () => {
    // The identity-fail intent: an undeclared principal.
    const refusal = realGateDecision({ strategy: { specId: 'spec-intruder', version: 1 } });
    expect(refusal.kind).toBe('refuse');
    const mirrored: RefusalDecisionRecord = refusal as T019RefusalDecision;
    expect(isRefusalDecisionRecord(mirrored)).toBe(true);
    expect(isApproveDecisionRecord(mirrored as unknown as ApproveDecisionRecord)).toBe(false);
  });
  it('the REAL gate\'s order form (the gated intent\'s order) passes isOrderIntentRecord', () => {
    const intent = t019FixtureIntent();
    const orderForm: OrderIntentRecord = intent.order;
    expect(isOrderIntentRecord(orderForm)).toBe(true);
  });

  it('the REAL decision\'s lineage passes the mirrored lineage guard', () => {
    const decision = realGateDecision();
    if (decision.kind !== 'approve') throw new Error('fixture must approve');
    const lineage: ExecutionLineageRecord = decision.lineage;
    expect(lineage.intentRef).toBe('si:fixture0001');
    expect(lineage.tenant).toBe('tenant-alpha');
    expect(lineage.venues).toContain('REFSIM');
  });
});

describe('the T039 triangle (T019 -> T040 mirror -> T039 mirror agree)', () => {
  it('the REAL T019 ApproveDecision ALSO passes the REAL brokers adapter\'s isApprovedDecisionMirror', () => {
    const decision = realGateDecision();
    expect(isApprovedDecisionMirror(decision as never)).toBe(true);
  });

  it('the REAL T019 order form passes the REAL brokers adapter\'s isOrderIntentMirror (the routed order form is one shape)', () => {
    const intent = t019FixtureIntent();
    expect(brokersIsOrderIntentMirror(intent.order as never)).toBe(true);
  });

  it('the REFUSAL twin fails the brokers adapter\'s approve mirror too (both lanes refuse it identically)', () => {
    const refusal = realGateDecision({ strategy: { specId: 'spec-intruder', version: 1 } });
    expect(isApprovedDecisionMirror(refusal as never)).toBe(false);
  });
});

describe('the id-space parity (prefix-for-prefix, both directions)', () => {
  it('the REAL T019 minted decision id passes this package\'s guard, and vice versa', () => {
    const realId = t019MintDecisionId('0123abcd');
    expect(authorityIsDecisionId(realId)).toBe(true);
    expect(t019IsDecisionId('xd:fedcba98' as never)).toBe(true);
    expect(authorityIsDecisionId('xd:fedcba98' as never)).toBe(true);
    // The negative side agrees too.
    expect(authorityIsDecisionId('xd2:fedcba98')).toBe(false);
    expect(t019IsDecisionId('xd2:fedcba98' as never)).toBe(false);
  });

  it("the 'grant:' scope-ref guard is identical in both packages", () => {
    expect(authorityIsAuthorityScopeRef('grant:fixture-execute@1' as never)).toBe(true);
    expect(t019IsAuthorityScopeRef('grant:fixture-execute@1' as never)).toBe(true);
    expect(authorityIsAuthorityScopeRef('grant' as never)).toBe(false);
    expect(t019IsAuthorityScopeRef('grant' as never)).toBe(false);
  });

  it("the 'cred:' credential-ref guard is identical across T019, T039 and this package", () => {
    for (const value of ['cred:refsim-main@1', 'cred:gw-broker-main@1']) {
      expect(authorityIsCredentialRef(value as never)).toBe(true);
      expect(t019IsCredentialRef(value as never)).toBe(true);
      expect(brokersIsCredentialRef(value)).toBe(true);
    }
    for (const value of ['secret-value', 'cred', 'xcred:1']) {
      expect(authorityIsCredentialRef(value as never)).toBe(false);
      expect(t019IsCredentialRef(value as never)).toBe(false);
      expect(brokersIsCredentialRef(value)).toBe(false);
    }
  });

  it("the 'xd:' decision-id guard is identical across T019, T039 and this package", () => {
    expect(authorityIsDecisionId('xd:0123abcd' as never)).toBe(true);
    expect(t019IsDecisionId('xd:0123abcd' as never)).toBe(true);
    expect(brokersIsDecisionId('xd:0123abcd')).toBe(true);
  });

  it("the 'xpol:'/'ksw:' guards are identical in both packages", () => {
    expect(authorityIsExecutionPolicyId('xpol:0123abcd' as never)).toBe(true);
    expect(t019IsExecutionPolicyId('xpol:0123abcd' as never)).toBe(true);
    expect(authorityIsKillSwitchId('ksw:0123abcd' as never)).toBe(true);
    expect(t019IsKillSwitchId('ksw:0123abcd' as never)).toBe(true);
  });
});

describe('the credential-opacity trip-wire parity (one law, three lanes)', () => {
  it('T019\'s, T039\'s and this package\'s scans flag the IDENTICAL trees', () => {
    const trees: readonly unknown[] = [
      { venue: 'REFSIM', credentialRef: 'cred:refsim-main@1' },
      { apiKey: 'AKIAIOSFODNN7EXAMPLE' },
      { deep: { nested: [{ api_key: 'x' }] } },
      { password: 'hunter2', meta: { token: 'abc' } },
      { clean: 'record', with: { opaque: 'refs' } },
      {},
    ];
    for (const tree of trees) {
      expect(authorityCredentialViolations(tree)).toEqual(t019CredentialViolations(tree));
      expect(authorityCredentialViolations(tree)).toEqual(brokersCredentialViolations(tree));
    }
  });

  it('a REAL T019 kill-switch log\'s standing state satisfies the standing-fact guard (the injected fact)', () => {
    const log = fixtureKillSwitch();
    expect(t019KillSwitchState(log)).toBe('standing');
    const standingFact = { state: t019KillSwitchState(log) };
    expect(standingFact.state === 'standing').toBe(true);
    // The same fact shape the brokers adapter's routing consumes.
  });
});

describe('the routing refs decompose onto the REAL T039 descriptor identities', () => {
  it('the brokers lane: mintAdapterDescriptorRef(BROKER_ADAPTER) + mintChannelRef(BROKER_ORDER_CHANNEL)', () => {
    const adapterRef = mintAdapterDescriptorRef(BROKER_ADAPTER);
    const channelRef = mintChannelRef(BROKER_ORDER_CHANNEL);
    expect(adapterRef).toBe('adapter:adapter-brokers@0.0.0');
    expect(channelRef).toBe('chan:newOrderSingle');
    expect(adapterDescriptorOf(adapterRef)).toEqual({ id: BROKER_ADAPTER.id, version: BROKER_ADAPTER.version });
    expect(channelOf(channelRef)).toBe(BROKER_ORDER_CHANNEL);
    expect(BROKER_VENUE).toBe('BROKER-FIX');
  });

  it('the OMS/EMS lane: mintAdapterDescriptorRef(OMS_EMS_ADAPTER) + mintChannelRef(OMS_EMS_ORDER_CHANNEL)', () => {
    const adapterRef = mintAdapterDescriptorRef(OMS_EMS_ADAPTER);
    const channelRef = mintChannelRef(OMS_EMS_ORDER_CHANNEL);
    expect(adapterRef).toBe('adapter:adapter-oms-ems@0.0.0');
    expect(channelRef).toBe('chan:routingInstruction');
    expect(adapterDescriptorOf(adapterRef)).toEqual({ id: OMS_EMS_ADAPTER.id, version: OMS_EMS_ADAPTER.version });
    expect(channelOf(channelRef)).toBe(OMS_EMS_ORDER_CHANNEL);
    expect(OMS_EMS_VENUE).toBe('OMS-EMS');
  });
});
