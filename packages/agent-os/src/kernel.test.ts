/**
 * @tradrl/agent-os — kernel reducer behavioral tests.
 *
 * Covers, per the T006 acceptance criteria:
 * - all fourteen operations exercised end-to-end through the reducer;
 * - reducer purity (input state never mutated; deeply frozen outputs);
 * - determinism (same log, same fold, deeply equal state);
 * - the full error taxonomy: unknown instance, cross-tenant, not
 *   subscribed, circular delegation chain, duplicate op id, monotonicity
 *   violations (plus the structural/supervisory completions);
 * - supervision: manager-chain enforcement, escalation routing, termination
 *   cascade (re-parenting + ESCALATE effects for reports);
 * - EXECUTE authority neutrality (L8): opaque tokens transported verbatim,
 *   and a source scan proving no authority evaluation exists;
 * - tenant isolation (L12): cross-tenant references rejected, per-tenant
 *   bootstrap windows, no cross-tenant lookups through the helpers.
 *
 * Timestamp scheme: `hierarchy()` spawns at TS, TS+1, TS+2, so the actor
 * baselines after setup are MGR=TS+2, W1=TS+1, W2=TS+2. Every operation
 * applied to a hierarchy-derived state uses offsets >= 100, safely above
 * every baseline; tests that intentionally violate monotonicity use
 * explicit values below the documented baseline.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  type AgentInstanceId,
  type AuthorityTokenRef,
  type BodyVersionRef,
  type InstanceRecord,
  type IntentRef,
  type KernelAuthority,
  type KernelOpId,
  type KernelOperation,
  type KernelState,
  type LessonRef,
  type MessageEnvelope,
  type MessagePayload,
  type ProposalRef,
  type QueryRef,
  type ReasonText,
  type SubstrateRef,
  type TaskRef,
  type TenantId,
  type TimestampMs,
  type TopicName,
  KERNEL_ACTION_NAMES,
  applyOperation,
  applyOperations,
  createInitialKernelState,
  createKernelAuthority,
  createKernelOperation,
  detectManagementCycle,
  existsInAnotherTenant,
  instanceOf,
  isDeeplyFrozen,
  isKernelEffect,
  isKernelState,
  mailboxOf,
  managerChainOf,
  reportsOf,
  replayOperationLog,
  subscribersOf,
  validateKernelState,
  agentInstanceId,
} from './index';

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const TENANT = 'tenant-one' as TenantId;
const OTHER_TENANT = 'tenant-two' as TenantId;
const TS = 1_700_000_000_000;

const BOOTSTRAP_ACTOR = agentInstanceId('control-plane-bootstrap');
const MGR = agentInstanceId('mgr-1');
const W1 = agentInstanceId('worker-1');
const W2 = agentInstanceId('worker-2');

function authority(
  allowed: readonly (typeof KERNEL_ACTION_NAMES)[number][],
  maxDelegationDepth = 0,
): KernelAuthority {
  return createKernelAuthority({
    allowedActions: allowed,
    deniedActions: [],
    maxDelegationDepth,
  });
}

const MANAGER_AUTHORITY = authority([...KERNEL_ACTION_NAMES], 3);
const WORKER_AUTHORITY = authority(
  ['DELEGATE', 'REQUEST', 'PUBLISH', 'SUBSCRIBE', 'CHALLENGE', 'PROPOSE', 'ESCALATE', 'OBSERVE', 'LEARN', 'REPORT'],
  1,
);

// Test-side operation builders. Fields arrive as plain strings/numbers and
// are branded through casts, so call sites stay terse while the constructed
// operations remain fully type-checked.

function spawn(
  opId: string,
  actor: AgentInstanceId,
  target: AgentInstanceId,
  managerId: AgentInstanceId | null,
  scope: KernelAuthority,
  timestamp: number,
  tenant: string = TENANT,
): KernelOperation {
  return createKernelOperation({
    opId: opId as KernelOpId,
    type: 'SPAWN',
    timestamp: timestamp as TimestampMs,
    actor,
    tenantId: tenant as TenantId,
    target,
    managerId,
    bodyVersionRef: 'body/atlas@1.2.0' as BodyVersionRef,
    substrateRef: 'acme/reasoner-2@2026.03' as SubstrateRef,
    authority: scope,
  });
}

function op(opId: string, type: string, fields: Record<string, unknown>): KernelOperation {
  const id = opId as KernelOpId;
  const tenantId = (((fields.tenant as string | undefined) ?? TENANT) as TenantId);
  const timestamp = fields.timestamp as TimestampMs;
  const actor = fields.actor as AgentInstanceId;
  const target = fields.target as AgentInstanceId;
  switch (type) {
    case 'TERMINATE':
      return createKernelOperation({
        opId: id,
        type: 'TERMINATE',
        timestamp,
        actor,
        tenantId,
        target,
        reason: fields.reason as ReasonText,
      });
    case 'DELEGATE':
      return createKernelOperation({
        opId: id,
        type: 'DELEGATE',
        timestamp,
        actor,
        tenantId,
        target,
        taskRef: fields.taskRef as TaskRef,
        managerChain: fields.managerChain as readonly AgentInstanceId[],
      });
    case 'REQUEST':
      return createKernelOperation({
        opId: id,
        type: 'REQUEST',
        timestamp,
        actor,
        tenantId,
        target,
        payload: fields.payload as MessagePayload,
      });
    case 'PUBLISH':
      return createKernelOperation({
        opId: id,
        type: 'PUBLISH',
        timestamp,
        actor,
        tenantId,
        topic: fields.topic as TopicName,
        payload: fields.payload as MessagePayload,
      });
    case 'SUBSCRIBE':
      return createKernelOperation({
        opId: id,
        type: 'SUBSCRIBE',
        timestamp,
        actor,
        tenantId,
        topic: fields.topic as TopicName,
        payload: fields.payload as MessagePayload,
      });
    case 'CHALLENGE':
      return createKernelOperation({
        opId: id,
        type: 'CHALLENGE',
        timestamp,
        actor,
        tenantId,
        target,
        proposalRef: fields.proposalRef as ProposalRef,
        verdict: 'challenged',
      });
    case 'PROPOSE':
      return createKernelOperation({
        opId: id,
        type: 'PROPOSE',
        timestamp,
        actor,
        tenantId,
        target,
        proposalRef: fields.proposalRef as ProposalRef,
        verdict: 'proposed',
      });
    case 'APPROVE':
      return createKernelOperation({
        opId: id,
        type: 'APPROVE',
        timestamp,
        actor,
        tenantId,
        target,
        proposalRef: fields.proposalRef as ProposalRef,
        verdict: fields.verdict as 'approved' | 'rejected',
      });
    case 'EXECUTE':
      return createKernelOperation({
        opId: id,
        type: 'EXECUTE',
        timestamp,
        actor,
        tenantId,
        intentRef: fields.intentRef as IntentRef,
        authorityTokenRef: fields.authorityTokenRef as AuthorityTokenRef,
      });
    case 'ESCALATE':
      return createKernelOperation({
        opId: id,
        type: 'ESCALATE',
        timestamp,
        actor,
        tenantId,
        reason: fields.reason as ReasonText,
        chain: fields.chain as readonly AgentInstanceId[],
      });
    case 'OBSERVE':
      return createKernelOperation({
        opId: id,
        type: 'OBSERVE',
        timestamp,
        actor,
        tenantId,
        queryRef: fields.ref as QueryRef,
      });
    case 'LEARN':
      return createKernelOperation({
        opId: id,
        type: 'LEARN',
        timestamp,
        actor,
        tenantId,
        lessonRef: fields.ref as LessonRef,
      });
    case 'REPORT':
      return createKernelOperation({
        opId: id,
        type: 'REPORT',
        timestamp,
        actor,
        tenantId,
        summary: {
          subject: fields.subject as AgentInstanceId,
          headline: fields.headline as string,
          detailRef: fields.detailRef as string,
        },
      });
    default:
      throw new Error(`test helper: unsupported op type ${type}`);
  }
}

/** The canonical three-instance hierarchy (1 manager, 2 reports). */
function hierarchy(): KernelState {
  const ops: readonly KernelOperation[] = [
    spawn('op-001', BOOTSTRAP_ACTOR, MGR, null, MANAGER_AUTHORITY, TS),
    spawn('op-002', MGR, W1, MGR, WORKER_AUTHORITY, TS + 1),
    spawn('op-003', MGR, W2, MGR, WORKER_AUTHORITY, TS + 2),
  ];
  const result = applyOperations(createInitialKernelState(), ops);
  expect(result.error).toBeNull();
  return result.state;
}

// ---------------------------------------------------------------------------
// The fourteen operations, end-to-end through the reducer
// ---------------------------------------------------------------------------

describe('all fourteen operations apply through the reducer', () => {
  const ops: readonly KernelOperation[] = [
    spawn('op-001', BOOTSTRAP_ACTOR, MGR, null, MANAGER_AUTHORITY, TS),
    spawn('op-002', MGR, W1, MGR, WORKER_AUTHORITY, TS + 100),
    spawn('op-003', MGR, W2, MGR, WORKER_AUTHORITY, TS + 200),
    op('op-004', 'SUBSCRIBE', { actor: W1, topic: 'signals.regime', payload: 'interest/regime', timestamp: TS + 300 }),
    op('op-005', 'SUBSCRIBE', { actor: MGR, topic: 'signals.regime', payload: 'interest/regime', timestamp: TS + 400 }),
    op('op-006', 'PUBLISH', { actor: MGR, topic: 'signals.regime', payload: 'signal/regime-shift', timestamp: TS + 500 }),
    op('op-007', 'REQUEST', { actor: W1, target: W2, payload: 'request/confirm-position', timestamp: TS + 600 }),
    op('op-008', 'DELEGATE', {
      actor: MGR,
      target: W1,
      taskRef: 'task/research-regime-shift',
      managerChain: [MGR],
      timestamp: TS + 700,
    }),
    op('op-009', 'PROPOSE', {
      actor: W1,
      target: MGR,
      proposalRef: 'proposal/plan-8',
      verdict: 'proposed',
      timestamp: TS + 800,
    }),
    op('op-010', 'CHALLENGE', {
      actor: MGR,
      target: W1,
      proposalRef: 'proposal/plan-8',
      verdict: 'challenged',
      timestamp: TS + 900,
    }),
    op('op-011', 'APPROVE', {
      actor: MGR,
      target: W1,
      proposalRef: 'proposal/plan-9',
      verdict: 'approved',
      timestamp: TS + 1000,
    }),
    op('op-012', 'ESCALATE', {
      actor: W1,
      reason: 'uncertainty above threshold',
      chain: [W1, MGR],
      timestamp: TS + 1100,
    }),
    op('op-013', 'OBSERVE', { actor: W1, ref: 'query/regime-features', timestamp: TS + 1200 }),
    op('op-014', 'LEARN', { actor: W1, ref: 'lesson/overfit-signal-42', timestamp: TS + 1300 }),
    op('op-015', 'REPORT', {
      actor: W1,
      subject: W1,
      headline: 'Research task complete',
      detailRef: 'report/doc-001',
      timestamp: TS + 1400,
    }),
    op('op-016', 'EXECUTE', {
      actor: MGR,
      intentRef: 'intent/buy-1-btc-limit',
      authorityTokenRef: 'authz/token-opaque-xyz',
      timestamp: TS + 1500,
    }),
    op('op-017', 'TERMINATE', { actor: MGR, target: W2, reason: 'task complete', timestamp: TS + 1600 }),
  ];

  it('accepts the full fourteen-op script', () => {
    const result = applyOperations(createInitialKernelState(), ops);
    expect(result.error).toBeNull();
    expect(result.state.operationLog.length).toBe(ops.length);
    expect(isKernelState(result.state)).toBe(true);
    expect(isDeeplyFrozen(result.state)).toBe(true);
    expect(isDeeplyFrozen(result.effects)).toBe(true);
    for (const effect of result.effects) {
      expect(isKernelEffect(effect)).toBe(true);
    }
  });

  it('records every op in the log and indexes the op ids', () => {
    const result = applyOperations(createInitialKernelState(), ops);
    for (const operation of ops) {
      expect(result.state.processedOpIds[operation.opId]).toBe(true);
    }
  });

  it('routes each transport op to the right effect kind', () => {
    const result = applyOperations(createInitialKernelState(), ops);
    const kinds = result.effects.map((effect) => effect.kind);
    expect(kinds).toContain('instance-spawned');
    expect(kinds).toContain('message-delivered');
    expect(kinds).toContain('escalated');
    expect(kinds).toContain('execution-transported');
    expect(kinds).toContain('observation-transported');
    expect(kinds).toContain('learning-transported');
    expect(kinds).toContain('report-transported');
    expect(kinds).toContain('instance-terminated');
  });
});

// ---------------------------------------------------------------------------
// SPAWN semantics
// ---------------------------------------------------------------------------

describe('SPAWN', () => {
  it('bootstraps a tenant with an externally-vouched root', () => {
    const result = applyOperation(createInitialKernelState(), spawn('op-1', BOOTSTRAP_ACTOR, MGR, null, MANAGER_AUTHORITY, TS));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(instanceOf(result.state, TENANT, MGR)?.managerId).toBeNull();
      expect(instanceOf(result.state, TENANT, MGR)?.spawnedBy).toBeNull();
    }
  });

  it('rejects bootstrap semantics when the tenant already has instances', () => {
    const state = hierarchy();
    const rogue = applyOperation(
      state,
      spawn('op-x', agentInstanceId('ghost-bootstrap'), agentInstanceId('ghost'), null, WORKER_AUTHORITY, TS + 9999),
    );
    expect(rogue.ok).toBe(false);
    if (!rogue.ok) expect(rogue.error.code).toBe('unknown-instance');
  });

  it('rejects duplicate instance ids within a tenant', () => {
    const state = hierarchy();
    const duplicate = applyOperation(state, spawn('op-x', MGR, W1, MGR, WORKER_AUTHORITY, TS + 100));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.code).toBe('duplicate-instance');
  });

  it('rejects self-management and unknown managers', () => {
    const state = hierarchy();
    const selfManaged = applyOperation(
      state,
      spawn('op-x', MGR, agentInstanceId('new-1'), agentInstanceId('new-1'), WORKER_AUTHORITY, TS + 101),
    );
    expect(selfManaged.ok).toBe(false);
    if (!selfManaged.ok) expect(selfManaged.error.code).toBe('invalid-operation');
    const dangling = applyOperation(
      state,
      spawn('op-y', MGR, agentInstanceId('new-2'), agentInstanceId('ghost-mgr'), WORKER_AUTHORITY, TS + 102),
    );
    expect(dangling.ok).toBe(false);
    if (!dangling.ok) expect(dangling.error.code).toBe('unknown-instance');
  });

  it('rejects contradictory authority scopes', () => {
    // Hand-crafted (factory-bypassing) record: structurally valid, semantically
    // contradictory — the REDUCER's spawn-time rejection is what's under test.
    const contradictory = {
      allowedActions: ['OBSERVE'],
      deniedActions: ['OBSERVE'],
      maxDelegationDepth: 0,
    } as KernelAuthority;
    const state = hierarchy();
    const bad = applyOperation(
      state,
      spawn('op-x', MGR, agentInstanceId('new-3'), MGR, contradictory, TS + 103),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('invalid-operation');
  });

  it('starts the spawned instance timeline at its spawn time', () => {
    const state = hierarchy();
    const result = applyOperation(
      state,
      spawn('op-x', MGR, agentInstanceId('new-4'), MGR, WORKER_AUTHORITY, TS + 5000),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const backdated = op('op-y', 'OBSERVE', { actor: agentInstanceId('new-4'), ref: 'query/x', timestamp: TS + 4999 });
      const applied = applyOperation(result.state, backdated);
      expect(applied.ok).toBe(false);
      if (!applied.ok) expect(applied.error.code).toBe('monotonicity-violation');
    }
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation (L12)
// ---------------------------------------------------------------------------

describe('tenant isolation', () => {
  it('rejects an actor that exists only in another tenant', () => {
    const state = hierarchy();
    const foreign = op('op-x', 'OBSERVE', { actor: W1, ref: 'query/x', timestamp: TS + 100, tenant: OTHER_TENANT });
    const result = applyOperation(state, foreign);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('cross-tenant');
      expect(result.error.message).toContain('tenant-two');
    }
    // The rejection left no state trace.
    expect(result.state).toBe(state);
  });

  it('rejects cross-tenant termination targets with the cross-tenant code', () => {
    const state = hierarchy();
    const foreign = op('op-x', 'TERMINATE', {
      actor: MGR,
      target: W2,
      reason: 'sneaky',
      timestamp: TS + 101,
      tenant: OTHER_TENANT,
    });
    const result = applyOperation(state, foreign);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cross-tenant');
  });

  it('bootstraps a second tenant independently', () => {
    const state = hierarchy();
    const otherRoot = agentInstanceId('other-root');
    const result = applyOperation(
      state,
      spawn('op-other-1', agentInstanceId('other-bootstrap'), otherRoot, null, MANAGER_AUTHORITY, TS + 100, OTHER_TENANT),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(instanceOf(result.state, OTHER_TENANT, otherRoot)).not.toBeNull();
      expect(instanceOf(result.state, TENANT, otherRoot)).toBeNull();
    }
  });

  it('keeps subscriptions and mailboxes tenant-scoped', () => {
    let state = hierarchy();
    const a = applyOperations(state, [
      op('op-s1', 'SUBSCRIBE', { actor: W1, topic: 'shared.topic', payload: 'interest', timestamp: TS + 100 }),
    ]);
    expect(a.error).toBeNull();
    state = a.state;
    const otherRoot = agentInstanceId('other-root');
    const b = applyOperations(state, [
      spawn('op-other-1', agentInstanceId('other-bootstrap'), otherRoot, null, MANAGER_AUTHORITY, TS + 101, OTHER_TENANT),
      op('op-other-2', 'SUBSCRIBE', {
        actor: otherRoot,
        topic: 'shared.topic',
        payload: 'interest',
        timestamp: TS + 102,
        tenant: OTHER_TENANT,
      }),
      op('op-other-3', 'PUBLISH', {
        actor: otherRoot,
        topic: 'shared.topic',
        payload: 'signal/other-tenant',
        timestamp: TS + 103,
        tenant: OTHER_TENANT,
      }),
    ]);
    expect(b.error).toBeNull();
    if (b.error === null) {
      // W1 (tenant-one) must NOT have received the other-tenant publish.
      expect(mailboxOf(b.state, TENANT, W1)).toEqual([]);
      expect(mailboxOf(b.state, OTHER_TENANT, otherRoot).length).toBe(1);
      // Subscriptions are per-tenant: same topic name, disjoint registries.
      expect(subscribersOf(b.state, TENANT, 'shared.topic' as TopicName)).toContain(W1);
      expect(subscribersOf(b.state, OTHER_TENANT, 'shared.topic' as TopicName)).not.toContain(W1);
    }
  });

  it('exposes cross-tenant existence only for rejection (L12 trip wire)', () => {
    const state = hierarchy();
    expect(existsInAnotherTenant(state, TENANT, W1)).toBe(false);
    expect(existsInAnotherTenant(state, OTHER_TENANT, W1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PUBLISH / SUBSCRIBE semantics
// ---------------------------------------------------------------------------

describe('PUBLISH / SUBSCRIBE', () => {
  function subscribed(): KernelState {
    const state = hierarchy();
    const result = applyOperations(state, [
      op('op-s1', 'SUBSCRIBE', { actor: W1, topic: 'signals.regime', payload: 'interest', timestamp: TS + 100 }),
      op('op-s2', 'SUBSCRIBE', { actor: MGR, topic: 'signals.regime', payload: 'interest', timestamp: TS + 101 }),
    ]);
    expect(result.error).toBeNull();
    return result.state;
  }

  it('delivers one envelope to every subscriber (including the publisher)', () => {
    const state = subscribed();
    const result = applyOperation(
      state,
      op('op-p1', 'PUBLISH', { actor: MGR, topic: 'signals.regime', payload: 'signal/x', timestamp: TS + 102 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(mailboxOf(result.state, TENANT, W1).length).toBe(1);
      expect(mailboxOf(result.state, TENANT, MGR).length).toBe(1);
      const envelope = mailboxOf(result.state, TENANT, W1)[0];
      expect(envelope?.topic).toBe('signals.regime');
      expect(envelope?.sender).toBe(MGR);
      expect(envelope?.causalityId).toBe('op-p1');
      expect(envelope?.sequence).toBe(1);
      expect(result.effects.length).toBe(2);
      for (const effect of result.effects) {
        expect(effect.kind).toBe('message-delivered');
      }
    }
  });

  it('rejects publishing without membership (the frozen not-subscribed taxonomy entry)', () => {
    const state = subscribed();
    const result = applyOperation(
      state,
      op('op-p2', 'PUBLISH', { actor: W2, topic: 'signals.regime', payload: 'signal/y', timestamp: TS + 103 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-subscribed');
      expect(result.state).toBe(state);
    }
  });

  it('rejects publishing and subscribing on reserved kernel topics', () => {
    const state = subscribed();
    const publish = applyOperation(
      state,
      op('op-p3', 'PUBLISH', { actor: MGR, topic: 'kernel.escalate', payload: 'signal/y', timestamp: TS + 104 }),
    );
    expect(publish.ok).toBe(false);
    if (!publish.ok) expect(publish.error.code).toBe('invalid-operation');
    const subscribe = applyOperation(
      state,
      op('op-p4', 'SUBSCRIBE', { actor: MGR, topic: 'kernel.request', payload: 'interest', timestamp: TS + 105 }),
    );
    expect(subscribe.ok).toBe(false);
    if (!subscribe.ok) expect(subscribe.error.code).toBe('invalid-operation');
  });

  it('SUBSCRIBE is idempotent', () => {
    const state = subscribed();
    const before = subscribersOf(state, TENANT, 'signals.regime' as TopicName);
    const again = applyOperation(
      state,
      op('op-s3', 'SUBSCRIBE', { actor: W1, topic: 'signals.regime', payload: 'interest', timestamp: TS + 106 }),
    );
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(subscribersOf(again.state, TENANT, 'signals.regime' as TopicName)).toEqual(before);
      expect(again.effects).toEqual([]);
    }
  });

  it('assigns strictly increasing per-sender sequences', () => {
    const state = subscribed();
    const result = applyOperations(state, [
      op('op-p5', 'PUBLISH', { actor: MGR, topic: 'signals.regime', payload: 'signal/1', timestamp: TS + 107 }),
      op('op-r1', 'REQUEST', { actor: MGR, target: W1, payload: 'request/1', timestamp: TS + 108 }),
      op('op-p6', 'PUBLISH', { actor: MGR, topic: 'signals.regime', payload: 'signal/2', timestamp: TS + 109 }),
    ]);
    expect(result.error).toBeNull();
    const sequences = mailboxOf(result.state, TENANT, W1)
      .filter((envelope) => envelope.sender === MGR)
      .map((envelope) => envelope.sequence);
    expect(sequences).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// DELEGATE semantics
// ---------------------------------------------------------------------------

describe('DELEGATE', () => {
  it('delivers the task envelope to the delegatee', () => {
    const state = hierarchy();
    const result = applyOperation(
      state,
      op('op-d1', 'DELEGATE', {
        actor: MGR,
        target: W1,
        taskRef: 'task/research-regime-shift',
        managerChain: [MGR],
        timestamp: TS + 100,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const envelope = mailboxOf(result.state, TENANT, W1)[0];
      expect(envelope?.topic).toBe('kernel.delegate');
      expect(envelope?.payload).toBe('task/research-regime-shift');
      expect(envelope?.causalityId).toBe('op-d1');
    }
  });

  it('rejects chains that do not end with the actor', () => {
    const state = hierarchy();
    const result = applyOperation(
      state,
      op('op-d2', 'DELEGATE', {
        actor: W1,
        target: W2,
        taskRef: 'task/x',
        managerChain: [MGR],
        timestamp: TS + 101,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-delegation-chain');
  });

  it('rejects circular delegation chains (duplicate members and returning targets)', () => {
    const state = hierarchy();
    const duplicate = applyOperation(
      state,
      op('op-d3', 'DELEGATE', {
        actor: W1,
        target: W2,
        taskRef: 'task/x',
        managerChain: [MGR, W1, MGR, W1],
        timestamp: TS + 102,
      }),
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.code).toBe('circular-delegation-chain');

    const selfTarget = applyOperation(
      state,
      op('op-d4', 'DELEGATE', {
        actor: W1,
        target: W1,
        taskRef: 'task/x',
        managerChain: [MGR, W1],
        timestamp: TS + 103,
      }),
    );
    expect(selfTarget.ok).toBe(false);
    if (!selfTarget.ok) expect(selfTarget.error.code).toBe('circular-delegation-chain');

    const backToManager = applyOperation(
      state,
      op('op-d5', 'DELEGATE', {
        actor: W1,
        target: MGR,
        taskRef: 'task/x',
        managerChain: [MGR, W1],
        timestamp: TS + 104 },
      ),
    );
    expect(backToManager.ok).toBe(false);
    if (!backToManager.ok) expect(backToManager.error.code).toBe('circular-delegation-chain');
  });

  it('rejects delegation chains that exceed a member\'s declared depth', () => {
    // WORKER_AUTHORITY has maxDelegationDepth = 1: MGR -> W1 -> W2 is legal,
    // but a chain that would put TWO hops below W1 is not.
    const state = hierarchy();
    const W3 = agentInstanceId('worker-3');
    const setup = applyOperations(state, [
      spawn('op-s1', MGR, W3, MGR, WORKER_AUTHORITY, TS + 100),
      op('op-d6', 'DELEGATE', {
        actor: MGR,
        target: W1,
        taskRef: 'task/x',
        managerChain: [MGR],
        timestamp: TS + 101,
      }),
      op('op-d7', 'DELEGATE', {
        actor: W1,
        target: W2,
        taskRef: 'task/x',
        managerChain: [MGR, W1],
        timestamp: TS + 102,
      }),
    ]);
    expect(setup.error).toBeNull();

    const onward = applyOperation(
      setup.state,
      op('op-d8', 'DELEGATE', {
        actor: W2,
        target: W3,
        taskRef: 'task/x',
        managerChain: [MGR, W1, W2],
        timestamp: TS + 103,
      }),
    );
    expect(onward.ok).toBe(false);
    if (!onward.ok) {
      expect(onward.error.code).toBe('delegation-depth-exceeded');
      expect(onward.error.message).toContain('worker-1');
    }
  });

  it('rejects chain members that are not live instances of the tenant', () => {
    const state = hierarchy();
    const ghost = applyOperation(
      state,
      op('op-d9', 'DELEGATE', {
        actor: W1,
        target: W2,
        taskRef: 'task/x',
        managerChain: [agentInstanceId('ghost'), W1],
        timestamp: TS + 104,
      }),
    );
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.error.code).toBe('unknown-instance');
  });
});

// ---------------------------------------------------------------------------
// TERMINATE semantics and the termination cascade
// ---------------------------------------------------------------------------

describe('TERMINATE and the cascade policy', () => {
  it('enforces the manager chain: only the target or an ancestor may terminate', () => {
    const state = hierarchy();
    // A warden WITH terminate authority but NO manager relationship.
    const WARDEN = agentInstanceId('warden-1');
    const spawned = applyOperation(
      state,
      spawn('op-w1', MGR, WARDEN, MGR, authority([...KERNEL_ACTION_NAMES], 0), TS + 100),
    );
    expect(spawned.ok).toBe(true);
    if (!spawned.ok) return;

    const byPeer = applyOperation(
      spawned.state,
      op('op-t1', 'TERMINATE', { actor: WARDEN, target: W2, reason: 'not my report', timestamp: TS + 101 }),
    );
    expect(byPeer.ok).toBe(false);
    if (!byPeer.ok) expect(byPeer.error.code).toBe('manager-chain-violation');

    const byManager = applyOperation(
      state,
      op('op-t2', 'TERMINATE', { actor: MGR, target: W2, reason: 'done', timestamp: TS + 102 }),
    );
    expect(byManager.ok).toBe(true);

    const bySelf = applyOperation(
      state,
      op('op-t3', 'TERMINATE', { actor: W2, target: W2, reason: 'self', timestamp: TS + 103 }),
    );
    // W2 lacks TERMINATE in WORKER_AUTHORITY: authority fires before semantics.
    expect(bySelf.ok).toBe(false);
    if (!bySelf.ok) expect(bySelf.error.code).toBe('action-not-allowed');
  });

  it('removes the instance, its mailbox and its subscriptions', () => {
    let state = hierarchy();
    const result = applyOperations(state, [
      op('op-s1', 'SUBSCRIBE', { actor: W2, topic: 'signals.regime', payload: 'interest', timestamp: TS + 100 }),
      op('op-r1', 'REQUEST', { actor: MGR, target: W2, payload: 'request/x', timestamp: TS + 101 }),
    ]);
    expect(result.error).toBeNull();
    state = result.state;
    expect(mailboxOf(state, TENANT, W2).length).toBe(1);
    expect(subscribersOf(state, TENANT, 'signals.regime' as TopicName)).toContain(W2);

    const terminated = applyOperation(
      state,
      op('op-t4', 'TERMINATE', { actor: MGR, target: W2, reason: 'task complete', timestamp: TS + 102 }),
    );
    expect(terminated.ok).toBe(true);
    if (terminated.ok) {
      expect(instanceOf(terminated.state, TENANT, W2)).toBeNull();
      expect(mailboxOf(terminated.state, TENANT, W2)).toEqual([]);
      expect(subscribersOf(terminated.state, TENANT, 'signals.regime' as TopicName)).not.toContain(W2);
      // 3 spawns + subscribe + request + terminate.
      expect(terminated.state.operationLog.length).toBe(6);
    }
  });

  it('terminating a mid-level manager re-parents its reports and escalates them', () => {
    // root -> mid -> leaf1, leaf2
    const ROOT = agentInstanceId('root-1');
    const MID = agentInstanceId('mid-1');
    const LEAF1 = agentInstanceId('leaf-1');
    const LEAF2 = agentInstanceId('leaf-2');
    const setup = applyOperations(createInitialKernelState(), [
      spawn('op-1', BOOTSTRAP_ACTOR, ROOT, null, MANAGER_AUTHORITY, TS),
      spawn('op-2', ROOT, MID, ROOT, authority([...KERNEL_ACTION_NAMES], 3), TS + 1),
      spawn('op-3', MID, LEAF1, MID, WORKER_AUTHORITY, TS + 2),
      spawn('op-4', MID, LEAF2, MID, WORKER_AUTHORITY, TS + 3),
    ]);
    expect(setup.error).toBeNull();
    const state = setup.state;

    const terminated = applyOperation(
      state,
      op('op-5', 'TERMINATE', { actor: ROOT, target: MID, reason: 'restructuring', timestamp: TS + 10 }),
    );
    expect(terminated.ok).toBe(true);
    if (terminated.ok) {
      // Re-parented to ROOT (the terminated manager's manager).
      expect(instanceOf(terminated.state, TENANT, LEAF1)?.managerId).toBe(ROOT);
      expect(instanceOf(terminated.state, TENANT, LEAF2)?.managerId).toBe(ROOT);
      // One ESCALATE effect per report.
      const escalations = terminated.effects.filter((effect) => effect.kind === 'escalated');
      expect(escalations.length).toBe(2);
      for (const effect of escalations) {
        if (effect.kind === 'escalated') {
          expect(effect.to).toBe(ROOT);
          expect(effect.chain).toContain(MID);
          expect(effect.reason).toContain('manager-terminated');
          expect(effect.reason).toContain('restructuring');
        }
      }
      // One cascade mailbox message per report, deposited in ROOT's mailbox.
      const cascadeMessages = mailboxOf(terminated.state, TENANT, ROOT).filter(
        (envelope) => envelope.topic === 'kernel.cascade-escalate',
      );
      expect(cascadeMessages.length).toBe(2);
      expect(new Set(cascadeMessages.map((envelope) => envelope.sender))).toEqual(new Set([LEAF1, LEAF2]));
      // And ROOT can now terminate the re-parented reports (chain holds).
      const finish = applyOperation(
        terminated.state,
        op('op-6', 'TERMINATE', { actor: ROOT, target: LEAF1, reason: 'closing', timestamp: TS + 11 }),
      );
      expect(finish.ok).toBe(true);
    }
  });

  it('terminating a root manager promotes its reports to roots and surfaces escalations', () => {
    const state = hierarchy();
    const terminated = applyOperation(
      state,
      op('op-t5', 'TERMINATE', { actor: MGR, target: MGR, reason: 'shutting down', timestamp: TS + 100 }),
    );
    expect(terminated.ok).toBe(true);
    if (terminated.ok) {
      expect(instanceOf(terminated.state, TENANT, W1)?.managerId).toBeNull();
      expect(instanceOf(terminated.state, TENANT, W2)?.managerId).toBeNull();
      const escalations = terminated.effects.filter((effect) => effect.kind === 'escalated');
      expect(escalations.length).toBe(2);
      for (const effect of escalations) {
        if (effect.kind === 'escalated') expect(effect.to).toBeNull();
      }
      // No manager to deliver to: no cascade mailbox messages.
      expect(mailboxOf(terminated.state, TENANT, W1)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// ESCALATE semantics
// ---------------------------------------------------------------------------

describe('ESCALATE', () => {
  it('routes to the nearest manager and delivers an escalation message', () => {
    const state = hierarchy();
    const result = applyOperation(
      state,
      op('op-e1', 'ESCALATE', { actor: W1, reason: 'uncertainty above threshold', chain: [W1, MGR], timestamp: TS + 100 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effects.length).toBe(2);
      const escalation = result.effects[0];
      expect(escalation?.kind).toBe('escalated');
      if (escalation?.kind === 'escalated') {
        expect(escalation.from).toBe(W1);
        expect(escalation.to).toBe(MGR);
        expect(escalation.chain).toEqual([W1, MGR]);
      }
      const envelope = mailboxOf(result.state, TENANT, MGR)[0];
      expect(envelope?.topic).toBe('kernel.escalate');
      expect(envelope?.sender).toBe(W1);
      expect(envelope?.payload).toBe('uncertainty above threshold');
    }
  });

  it('rejects chains that do not match the live registry', () => {
    const state = hierarchy();
    const stale = applyOperation(
      state,
      op('op-e2', 'ESCALATE', { actor: W1, reason: 'x', chain: [W1], timestamp: TS + 101 }),
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe('escalation-chain-mismatch');

    const invented = applyOperation(
      state,
      op('op-e3', 'ESCALATE', {
        actor: W1,
        reason: 'x',
        chain: [W1, agentInstanceId('ghost'), MGR],
        timestamp: TS + 102,
      }),
    );
    expect(invented.ok).toBe(false);
    if (!invented.ok) expect(invented.error.code).toBe('escalation-chain-mismatch');
  });

  it('surfaces root escalations to the control plane (to = null)', () => {
    const state = hierarchy();
    const result = applyOperation(
      state,
      op('op-e4', 'ESCALATE', { actor: MGR, reason: 'strategy conflict', chain: [MGR], timestamp: TS + 103 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effects.length).toBe(1);
      const escalation = result.effects[0];
      expect(escalation?.kind).toBe('escalated');
      if (escalation?.kind === 'escalated') expect(escalation.to).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// EXECUTE authority neutrality (L8)
// ---------------------------------------------------------------------------

describe('EXECUTE is authority-neutral (L8)', () => {
  it('transports the intent and the authority token VERBATIM, never evaluating them', () => {
    const state = hierarchy();
    // The token is deliberately opaque garbage: the kernel must carry it
    // without inspecting, validating or branching on it in any way.
    const weirdToken = 'authz/✓-toralan-ν奇怪的-token::??';
    const execute = createKernelOperation({
      opId: 'op-x1' as KernelOpId,
      type: 'EXECUTE',
      timestamp: (TS + 100) as TimestampMs,
      actor: MGR,
      tenantId: TENANT,
      intentRef: 'intent/buy-1-btc-limit' as IntentRef,
      authorityTokenRef: weirdToken as AuthorityTokenRef,
    });
    const result = applyOperation(state, execute);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effects.length).toBe(1);
      const effect = result.effects[0];
      expect(effect?.kind).toBe('execution-transported');
      if (effect?.kind === 'execution-transported') {
        expect(effect.authorityTokenRef).toBe(weirdToken);
        expect(effect.intentRef).toBe('intent/buy-1-btc-limit');
        expect(effect.actor).toBe(MGR);
        expect(effect.causalityId).toBe('op-x1');
      }
      // No mailbox delivery, no state beyond the log.
      expect(mailboxOf(result.state, TENANT, MGR)).toEqual([]);
    }
  });

  it('still requires the EXECUTE verb in the actor\'s declarative whitelist', () => {
    const state = hierarchy();
    const deniedWorker = createKernelAuthority({
      allowedActions: ['OBSERVE', 'REPORT'],
      deniedActions: ['EXECUTE'],
      maxDelegationDepth: 0,
    });
    const spawnDenied = applyOperation(
      state,
      spawn('op-x2', MGR, agentInstanceId('no-exec-1'), MGR, deniedWorker, TS + 101),
    );
    expect(spawnDenied.ok).toBe(true);
    if (!spawnDenied.ok) return;
    const execute = createKernelOperation({
      opId: 'op-x3' as KernelOpId,
      type: 'EXECUTE',
      timestamp: (TS + 102) as TimestampMs,
      actor: agentInstanceId('no-exec-1'),
      tenantId: TENANT,
      intentRef: 'intent/x' as IntentRef,
      authorityTokenRef: 'authz/t' as AuthorityTokenRef,
    });
    const result = applyOperation(spawnDenied.state, execute);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('action-not-allowed');
  });

  it('carries a source scan proving no authority evaluation exists in the kernel', () => {
    // Trip wire (the "grep" half of acceptance criterion 6): outside the
    // structural `typeof` type-guards, no kernel source inspects an authority
    // token's or intent's content (comparisons, content methods) or invokes
    // wall clocks / randomness. Structural guards (isRecord / typeof checks)
    // validate SHAPE, never authority SEMANTICS — they are excluded from the
    // scan precisely, not by weakening it.
    const sources: readonly string[] = [
      'kernel.ts',
      'operations.ts',
      'authority.ts',
      'envelope.ts',
      'state.ts',
      'errors.ts',
      'actions.ts',
      'primitives.ts',
      'timestamp.ts',
    ];
    const contentMethods =
      '(?:trim|startsWith|endsWith|includes|match|slice|substring|substr|split|toLowerCase|toUpperCase|indexOf|lastIndexOf|charAt|charCodeAt|at|replace|replaceAll|localeCompare|normalize)';
    for (const file of sources) {
      const content = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      // Strip the structural typeof-guards (shape checks, not evaluation).
      const stripped = content
        .replace(/typeof\s+\w*\.?(?:authorityTokenRef|intentRef)\s*===\s*'string'/g, '')
        .replace(/typeof\s+\w*\.?(?:authorityTokenRef|intentRef)\s*!==\s*'string'/g, '');
      // The token/intent refs are only ever carried, never compared.
      expect(stripped).not.toMatch(/authorityTokenRef\s*(?:===|!==)/);
      expect(stripped).not.toMatch(/intentRef\s*(?:===|!==)/);
      // ...and never content-inspected through string methods.
      expect(stripped).not.toMatch(new RegExp(`authorityTokenRef\\s*\\.\\s*${contentMethods}\\s*\\(`));
      expect(stripped).not.toMatch(new RegExp(`intentRef\\s*\\.\\s*${contentMethods}\\s*\\(`));
      // Determinism: no wall clocks, no randomness anywhere in the kernel.
      expect(content).not.toMatch(/Date\.now|Math\.random|new\s+Date\s*\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// Validation-order and taxonomy completions
// ---------------------------------------------------------------------------

describe('validation order and remaining taxonomy entries', () => {
  it('rejects duplicate op ids (idempotent-keyed log)', () => {
    const state = hierarchy();
    const replay = applyOperation(state, state.operationLog[0] as KernelOperation);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error.code).toBe('duplicate-op-id');
  });

  it('rejects structurally invalid operations before anything else', () => {
    const state = hierarchy();
    const rogue = { opId: 'op-x', type: 'SPAWN', timestamp: TS, actor: MGR, tenantId: TENANT } as KernelOperation;
    const result = applyOperation(state, rogue);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-operation');
  });

  it('rejects unknown actors in populated tenants', () => {
    const state = hierarchy();
    const result = applyOperation(
      state,
      op('op-x', 'OBSERVE', { actor: agentInstanceId('ghost'), ref: 'query/x', timestamp: TS + 100 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown-instance');
  });

  it('rejects monotonicity violations (per-actor timestamps never go backwards)', () => {
    const state = hierarchy();
    // MGR's last accepted op is op-003 at TS+2.
    const backdated = applyOperation(
      state,
      op('op-x', 'OBSERVE', { actor: MGR, ref: 'query/x', timestamp: TS + 1 }),
    );
    expect(backdated.ok).toBe(false);
    if (!backdated.ok) expect(backdated.error.code).toBe('monotonicity-violation');
    // Equal timestamps are legal (non-decreasing).
    const equal = applyOperation(state, op('op-y', 'OBSERVE', { actor: MGR, ref: 'query/x', timestamp: TS + 2 }));
    expect(equal.ok).toBe(true);
  });

  it('rejects verbs outside the actor\'s whitelist', () => {
    const state = hierarchy();
    // WORKER_AUTHORITY lacks SPAWN.
    const result = applyOperation(
      state,
      spawn('op-x', W1, agentInstanceId('new-5'), W1, WORKER_AUTHORITY, TS + 100),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('action-not-allowed');
  });

  it('rejects non-SPAWN ops from an externally-vouched actor even in an empty tenant', () => {
    const result = applyOperation(
      createInitialKernelState(),
      op('op-x', 'OBSERVE', { actor: BOOTSTRAP_ACTOR, ref: 'query/x', timestamp: TS }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown-instance');
  });
});

// ---------------------------------------------------------------------------
// Purity and determinism
// ---------------------------------------------------------------------------

describe('reducer purity and determinism', () => {
  it('never mutates the input state (deepFreeze survives, JSON identical)', () => {
    const state = hierarchy();
    const before = JSON.stringify(state);
    expect(isDeeplyFrozen(state)).toBe(true);
    const result = applyOperation(
      state,
      op('op-x', 'TERMINATE', { actor: MGR, target: W2, reason: 'done', timestamp: TS + 100 }),
    );
    expect(result.ok).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
    expect(isDeeplyFrozen(state)).toBe(true);
    if (result.ok) {
      expect(JSON.stringify(result.state)).not.toBe(before);
    }
  });

  it('folding the same log twice yields deeply equal states (determinism proof)', () => {
    const ops: readonly KernelOperation[] = [
      spawn('op-001', BOOTSTRAP_ACTOR, MGR, null, MANAGER_AUTHORITY, TS),
      spawn('op-002', MGR, W1, MGR, WORKER_AUTHORITY, TS + 100),
      spawn('op-003', MGR, W2, MGR, WORKER_AUTHORITY, TS + 200),
      op('op-004', 'SUBSCRIBE', { actor: W1, topic: 'signals.regime', payload: 'interest', timestamp: TS + 300 }),
      op('op-005', 'SUBSCRIBE', { actor: MGR, topic: 'signals.regime', payload: 'interest', timestamp: TS + 400 }),
      op('op-006', 'PUBLISH', { actor: MGR, topic: 'signals.regime', payload: 'signal/x', timestamp: TS + 500 }),
      op('op-007', 'DELEGATE', {
        actor: MGR,
        target: W1,
        taskRef: 'task/x',
        managerChain: [MGR],
        timestamp: TS + 600,
      }),
      op('op-008', 'ESCALATE', { actor: W1, reason: 'r', chain: [W1, MGR], timestamp: TS + 700 }),
      op('op-009', 'TERMINATE', { actor: MGR, target: MGR, reason: 'shutdown', timestamp: TS + 800 }),
    ];
    const first = applyOperations(createInitialKernelState(), ops);
    const second = applyOperations(createInitialKernelState(), ops);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(JSON.stringify(first.state)).toBe(JSON.stringify(second.state));
    expect(JSON.stringify(first.effects)).toBe(JSON.stringify(second.effects));
  });

  it('replayOperationLog re-folds the state log to an identical state', () => {
    const ops: readonly KernelOperation[] = [
      spawn('op-001', BOOTSTRAP_ACTOR, MGR, null, MANAGER_AUTHORITY, TS),
      spawn('op-002', MGR, W1, MGR, WORKER_AUTHORITY, TS + 100),
      op('op-003', 'SUBSCRIBE', { actor: W1, topic: 't.x', payload: 'i', timestamp: TS + 150 }),
      op('op-004', 'SUBSCRIBE', { actor: MGR, topic: 't.x', payload: 'i', timestamp: TS + 160 }),
      op('op-005', 'PUBLISH', { actor: MGR, topic: 't.x', payload: 'p', timestamp: TS + 170 }),
      op('op-006', 'LEARN', { actor: W1, ref: 'lesson/1', timestamp: TS + 180 }),
    ];
    const result = applyOperations(createInitialKernelState(), ops);
    expect(result.error).toBeNull();
    const replayed = replayOperationLog(result.state);
    expect(replayed.error).toBeNull();
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(result.state));
  });

  it('rejected operations leave no trace in the log or state', () => {
    const state = hierarchy();
    const before = JSON.stringify(state);
    const rejected = applyOperation(
      state,
      op('op-x', 'TERMINATE', { actor: W1, target: MGR, reason: 'usurp', timestamp: TS + 100 }),
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.state).toBe(state);
      expect(JSON.stringify(rejected.state)).toBe(before);
    }
  });
});

// ---------------------------------------------------------------------------
// State helpers and semantic validation
// ---------------------------------------------------------------------------

describe('state helpers and semantic validation', () => {
  it('walks manager chains and reports', () => {
    const state = hierarchy();
    expect(managerChainOf(state, TENANT, W1)).toEqual([W1, MGR]);
    expect(managerChainOf(state, TENANT, MGR)).toEqual([MGR]);
    expect(managerChainOf(state, TENANT, agentInstanceId('ghost'))).toBeNull();
    expect(reportsOf(state, TENANT, MGR)).toEqual([W1, W2]);
    expect(reportsOf(state, TENANT, W1)).toEqual([]);
  });

  it('detects management cycles in hand-crafted state (defense in depth)', () => {
    const state = hierarchy();
    expect(detectManagementCycle(state, TENANT)).toBeNull();
    // Hand-craft a cycle: W2 manages MGR.
    const forged = JSON.parse(JSON.stringify(state)) as KernelState;
    const perTenant = forged.instances[TENANT] as Record<string, InstanceRecord> | undefined;
    if (perTenant !== undefined && perTenant[MGR] !== undefined) {
      perTenant[MGR] = { ...perTenant[MGR], managerId: W2 };
    }
    expect(detectManagementCycle(forged, TENANT)).toEqual([MGR, W2, MGR]);
    const validation = validateKernelState(forged);
    expect(validation.valid).toBe(false);
    expect(validation.violations.map((violation) => violation.code)).toContain('management-cycle');
  });

  it('validates healthy state cleanly', () => {
    const state = hierarchy();
    expect(validateKernelState(state).valid).toBe(true);
    expect(validateKernelState(state).violations).toEqual([]);
  });

  it('flags mailboxes and subscribers without live instances', () => {
    const state = hierarchy();
    const forged = JSON.parse(JSON.stringify(state)) as KernelState;
    const mailboxes = forged.mailboxes as Record<string, Record<string, MessageEnvelope[]>>;
    mailboxes[TENANT] = { ghost: [] };
    expect(validateKernelState(forged).violations.map((v) => v.code)).toContain('mailbox-without-instance');

    const forged2 = JSON.parse(JSON.stringify(state)) as KernelState;
    const subscriptions = forged2.subscriptions as Record<string, Record<string, AgentInstanceId[]>>;
    subscriptions[TENANT] = { 't.x': [agentInstanceId('ghost')] };
    expect(validateKernelState(forged2).violations.map((v) => v.code)).toContain('subscriber-without-instance');
  });

  it('guards the state structure totally', () => {
    expect(isKernelState(createInitialKernelState())).toBe(true);
    expect(isKernelState(hierarchy())).toBe(true);
    expect(isKernelState(null)).toBe(false);
    expect(isKernelState({})).toBe(false);
    expect(isKernelState({ ...createInitialKernelState(), operationLog: 'not-a-list' })).toBe(false);
    expect(isKernelState({ ...createInitialKernelState(), processedOpIds: { 'bad id!': true } })).toBe(false);
  });
});
