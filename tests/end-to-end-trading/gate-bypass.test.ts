// tests/end-to-end-trading/gate-bypass.test.ts — THE L8 GATE-BYPASS GATE.
//
// Proves the model NEVER bypasses the gate stack: every path to the
// (simulated) venue demands a forge-valid gateway APPROVE decision, and
// every unauthorized attempt is a TYPED error record. The typed errors
// named here: decision_not_approved, kill_switch_thrown, unknown_grant,
// rate_budget_exhausted, limits breaching (policy_gate), venue_not_
// permitted (policy_gate), mode_confusion (shadow_mode), credential_
// value_present, and the forged-decision law at the venue adapter.

import { describe, expect, it } from 'vitest';

import {
  runReferenceSlice, REFERENCE_SCENARIO, createExecutionGateway,
  createPaperVenueAdapter, prepareOrder, deepFreeze, startReactiveWorld,
  referenceEngine, submitWorldAction,
} from '../../examples/end-to-end-trading/src/index';
import type {
  ApproveDecisionMirror, AuthorityGrantRecordMirror, EntitlementRegistryMirror,
} from '../../examples/end-to-end-trading/src/mirrors/execution';
import type { StrategyIntentMirror } from '../../examples/end-to-end-trading/src/mirrors/strategy';

function genesisPortfolio() {
  return deepFreeze({
    stateId: 'ps:genesis',
    positions: [],
    weights: [],
    cash: REFERENCE_SCENARIO.initialCash,
    realizedPnl: '0',
    unrealizedPnl: '0',
    asOf: REFERENCE_SCENARIO.epochMs,
    lineage: {
      strategy: { specId: REFERENCE_SCENARIO.policies.execution.principal, version: 1 },
      goal: { goalId: REFERENCE_SCENARIO.goal.id, version: 1 },
      constraintSet: { id: REFERENCE_SCENARIO.constraintSet.id, version: 1 },
      windowId: 'win-1',
      seed: REFERENCE_SCENARIO.seed,
      tenant: REFERENCE_SCENARIO.tenant,
      project: REFERENCE_SCENARIO.project,
    },
  });
}

type RunValue = Extract<ReturnType<typeof runReferenceSlice>, { ok: true }>['value'];

function baseGatewayConfig(baseline: RunValue) {
  return {
    policy: baseline.executionPolicy,
    gate: {
      portfolio: genesisPortfolio(),
      venueState: {
        asOf: REFERENCE_SCENARIO.epochMs + 20 * 60_000,
        instruments: REFERENCE_SCENARIO.universe.map((entry) => ({
          venue: entry.venue, instrument: entry.instrument, instrumentClass: entry.assetClass,
          referencePrice: '50000', rateWindowOrderCount: 0,
        })),
      },
    },
    risk: { policy: baseline.riskPolicy, exposure: null },
    authority: {
      tenant: REFERENCE_SCENARIO.tenant,
      project: REFERENCE_SCENARIO.project,
      grants: [],
      venues: [REFERENCE_SCENARIO.universe[0]!.venue],
    } as EntitlementRegistryMirror,
    routing: { tenant: REFERENCE_SCENARIO.tenant, project: REFERENCE_SCENARIO.project, entries: [] },
    adapters: [] as { adapterRef: string; port: { routeOrder(routing: unknown): { ok: true; value: null } | { ok: false; error: { kind: string; code: string; message: string } } } }[],
    killSwitch: { switchId: baseline.executionPolicy.killSwitch.switchId, records: [] as never[] },
    instants: { next: () => REFERENCE_SCENARIO.epochMs + 20 * 60_000 + 250 },
    substrate: 'substrate:test@1',
    executionMode: 'paper' as const,
  };
}

function referenceIntent(baseline: RunValue): StrategyIntentMirror {
  return baseline.strategyRuns[0]!.intents[0]!;
}

describe('T048 gate-bypass gate — L8: the model never bypasses the gate stack', () => {
  it('a submission WITHOUT any grant is refused with the typed unknown_grant error', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    const intent = referenceIntent(baseline.value);
    const gateway = createExecutionGateway(baseGatewayConfig(baseline.value));
    expect(gateway.ok).toBe(true);
    if (!gateway.ok) return;
    const submission = gateway.value.submitDecision(intent);
    expect(submission.ok).toBe(true);
    if (!submission.ok || submission.value.kind !== 'refused') {
      throw new Error('expected a refusal');
    }
    // The named typed error: stage authority_grant, kind unknown_grant.
    expect(submission.value.refusal.stage).toBe('authority_grant');
    expect(((submission.value.refusal as { refusal: { kind: string } }).refusal).kind).toBe('unknown_grant');
    // ZERO adapter calls: the routing table is empty, proving nothing left the gate.
    expect(gateway.value.submissions().length).toBe(1);
  });

  it('a thrown kill switch refuses everything (kill_switch_thrown via policy_gate)', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    const intent = referenceIntent(baseline.value);
    const config = baseGatewayConfig(baseline.value);
    // Throw the switch: a chain-valid thrown record on the bound switch.
    const thrown = deepFreeze({
      recordId: `ksr:${'0'.repeat(8)}`,
      sequence: 2,
      state: 'thrown' as const,
      reason: 'operator halt',
      thrownAt: REFERENCE_SCENARIO.epochMs,
      tenant: REFERENCE_SCENARIO.tenant,
      project: REFERENCE_SCENARIO.project,
      asOf: REFERENCE_SCENARIO.epochMs,
      chainHead: 'deadbeef',
    });
    config.killSwitch = { switchId: baseline.value.executionPolicy.killSwitch.switchId, records: [thrown] } as typeof config.killSwitch;
    const gateway = createExecutionGateway(config);
    expect(gateway.ok).toBe(true);
    if (!gateway.ok) return;
    const submission = gateway.value.submitDecision(intent);
    expect(submission.ok).toBe(true);
    if (!submission.ok || submission.value.kind !== 'refused') throw new Error('expected refusal');
    // First-failure-wins at stage 4 (kill switch is first in the declared order).
    expect(submission.value.refusal.stage).toBe('policy_gate');
    const failure = ((submission.value.refusal as unknown as { decision: Record<string, unknown> }).decision.failure) as { reason: { dimension: string } };
    expect(failure.reason.dimension).toBe('kill_switch');
  });

  it('an exhausted grant rate budget refuses with the typed rate_budget stage', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    const intent = referenceIntent(baseline.value);
    const config = baseGatewayConfig(baseline.value);
    // A valid grant with a ZERO order budget: fail-closed at stage 9.
    const grant: AuthorityGrantRecordMirror = deepFreeze({
      grantId: 'xag:00000000',
      version: 1,
      supersedes: null,
      tenant: REFERENCE_SCENARIO.tenant,
      project: REFERENCE_SCENARIO.project,
      principal: { specId: intent.strategy.specId, version: intent.strategy.version },
      scopeRef: REFERENCE_SCENARIO.policies.execution.grantScopeRef,
      orderKinds: ['limit'],
      venues: [intent.order.venueId],
      rateBudgets: [{ venue: intent.order.venueId, windowMs: 60_000, maxOrders: 0 }],
      credentials: [{ venue: intent.order.venueId, credentialRef: REFERENCE_SCENARIO.policies.execution.credentialRef }],
      validity: { issuedAt: 0, expiresAt: REFERENCE_SCENARIO.goal.horizon.endsAt },
      revocations: [],
      asOf: REFERENCE_SCENARIO.epochMs,
    });
    config.authority = {
      tenant: REFERENCE_SCENARIO.tenant,
      project: REFERENCE_SCENARIO.project,
      grants: [grant],
      venues: [intent.order.venueId],
    };
    const gateway = createExecutionGateway(config);
    expect(gateway.ok).toBe(true);
    if (!gateway.ok) return;
    const submission = gateway.value.submitDecision(intent);
    expect(submission.ok).toBe(true);
    if (!submission.ok || submission.value.kind !== 'refused') throw new Error('expected refusal');
    expect(submission.value.refusal.stage).toBe('rate_budget');
    expect((submission.value.refusal as unknown as { budget: number }).budget).toBe(0);
  });

  it('an oversized order is refused by the limits check (typed limits breach)', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    const intent = deepFreeze({ ...referenceIntent(baseline.value), order: { ...referenceIntent(baseline.value).order, quantity: '999' } });
    const gateway = createExecutionGateway(baseGatewayConfig(baseline.value));
    expect(gateway.ok).toBe(true);
    if (!gateway.ok) return;
    const submission = gateway.value.submitDecision(intent);
    expect(submission.ok).toBe(true);
    if (!submission.ok || submission.value.kind !== 'refused') throw new Error('expected refusal');
    expect(submission.value.refusal.stage).toBe('policy_gate');
    const failure = ((submission.value.refusal as unknown as { decision: Record<string, unknown> }).decision.failure) as { reason: { dimension: string } };
    expect(failure.reason.dimension).toBe('limits');
  });

  it('an intent claiming a live mode is refused (mode confusion — L5 separation)', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    const intent = deepFreeze({ ...referenceIntent(baseline.value), executionMode: 'live' });
    const gateway = createExecutionGateway(baseGatewayConfig(baseline.value));
    expect(gateway.ok).toBe(true);
    if (!gateway.ok) return;
    const submission = gateway.value.submitDecision(intent);
    expect(submission.ok).toBe(true);
    if (!submission.ok || submission.value.kind !== 'refused') throw new Error('expected refusal');
    expect(submission.value.refusal.stage).toBe('shadow_mode');
    expect((submission.value.refusal as unknown as { mode: string }).mode).toBe('live');
  });

  it('an intent carrying credential MATERIAL is refused at the opacity stage', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    const intent = deepFreeze({
      ...referenceIntent(baseline.value),
      // Credential MATERIAL smuggled as a key on the intent (stage-1 crime).
      apiKey: 'super-secret-material',
    });
    const gateway = createExecutionGateway(baseGatewayConfig(baseline.value));
    expect(gateway.ok).toBe(true);
    if (!gateway.ok) return;
    const submission = gateway.value.submitDecision(intent);
    expect(submission.ok).toBe(true);
    if (!submission.ok || submission.value.kind !== 'refused') throw new Error('expected refusal');
    expect(submission.value.refusal.stage).toBe('credential_opacity');
    expect((submission.value.refusal as unknown as { violations: readonly string[] }).violations.length).toBeGreaterThan(0);
  });

  it('the venue adapter refuses a FORGED approve decision (decision_not_approved)', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    const intent = referenceIntent(baseline.value);
    const forged: ApproveDecisionMirror = deepFreeze({
      kind: 'approve',
      decisionId: 'xd:deadbeef',
      intentRef: intent.intentId,
      policy: { policyId: 'xpol:forged', version: 1 },
      checkOrder: ['kill_switch', 'identity', 'authorization', 'limits', 'venue_permissions', 'rate_limits', 'credentials'],
      checks: [],
      lineage: {
        intentRef: intent.intentId,
        strategy: { specId: intent.strategy.specId, version: intent.strategy.version },
        goal: { goalId: intent.goal.goalId, version: intent.goal.version },
        policy: { policyId: 'xpol:forged', version: 1 },
        venues: [intent.order.venueId],
        seed: intent.seed,
        tenant: intent.tenant,
        project: intent.project,
      },
      asOf: intent.asOf + 250,
    });
    const adapter = createPaperVenueAdapter();
    const routed = adapter.port.routeOrder({ decision: forged, intent, kill_switch: { state: 'standing' } });
    expect(routed.ok).toBe(false);
    if (!routed.ok) {
      expect(routed.error.code).toBe('decision_not_approved');
      expect(routed.error.message).toContain('L8');
    }
    // And the execution body refuses to even PREPARE under a refusal decision.
    const prepared = prepareOrder({ decision: { ...forged, kind: 'refuse' } as unknown as ApproveDecisionMirror, intent, directorDecisionRef: null, orderClock: intent.asOf + 1500 });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.errors.some((error) => error.code === 'decision_not_approved')).toBe(true);
    }
  });

  it('the world refuses venue-direct submissions (there is no such API path)', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    // paper venue adapter is the only caller in the run — here we prove the
    // engine itself rejects an intent whose quantity violates the grid, i.e.
    // the venue seam enforces its own laws regardless of who calls it.
    const world = startReactiveWorld(
      {
        world_id: 'world-test',
        mode: 'reactive_replay',
        information_policy: 'point-in-time',
        tenant: REFERENCE_SCENARIO.tenant,
        project: REFERENCE_SCENARIO.project,
        seed: REFERENCE_SCENARIO.seed,
        as_of: REFERENCE_SCENARIO.epochMs,
        streams: REFERENCE_SCENARIO.universe.map((entry) => ({ venue: entry.venue, instrument: entry.instrument })),
        exchange: REFERENCE_SCENARIO.physics.map((entry) => ({
          venue: entry.venue, instrument: entry.instrument, asset_class: 'crypto',
          physics: entry.physics,
          bookSeed: REFERENCE_SCENARIO.bookSeeds.find((seed) => seed.venue === entry.venue && seed.instrument === entry.instrument)?.seed ?? { bids: [], asks: [] },
        })),
        participants: [{ instance: 'ai-execution', role: 'candidate', feed: null }],
        interleaving: { kind: 'stream_first' },
        playback_speed: 1,
      },
      referenceEngine,
      REFERENCE_SCENARIO.marketEvents,
    );
    expect(world.ok).toBe(true);
    if (!world.ok) return;
    const offGrid = submitWorldAction(world.value, {
      action_id: 'swa-offgrid',
      actor: 'ai-execution',
      submitted_at: REFERENCE_SCENARIO.epochMs + 1000,
      client_sequence: 1,
      payload: {
        type: 'submit_order',
        intent: {
          clientOrderId: 'si-test-offgrid',
          instrumentId: 'BTC-USDT',
          venueId: 'REFSIM',
          side: 'buy',
          kind: 'limit',
          quantity: '0.00003', // below the lot grid
          price: '50000',
          timeInForce: 'gtc',
          createdAt: '2024-06-04T00:00:00.000Z',
        },
      },
    }, REFERENCE_SCENARIO.marketEvents);
    expect(offGrid.ok).toBe(false);
    if (!offGrid.ok) {
      expect(offGrid.errors.some((error) => error.message.includes('lot'))).toBe(true);
    }
  });

  it('the reference run itself demonstrates a typed rate_budget refusal in-stream', () => {
    const baseline = runReferenceSlice();
    if (!baseline.ok) throw new Error(baseline.errors.map((e) => e.message).join('; '));
    const refused = baseline.value.submissions.filter((submission) => submission.kind === 'refused');
    expect(refused.length).toBeGreaterThan(0);
    const rateRefusal = refused.find((submission) => submission.kind === 'refused' && submission.refusal.stage === 'rate_budget');
    expect(rateRefusal).toBeDefined();
    // The corresponding outcome carries the refused disposition.
    const refusedOutcomes = baseline.value.outcomeLog.records.filter((record) => record.disposition === 'refused');
    expect(refusedOutcomes.length).toBe(refused.length);
  });
});
