/**
 * @tradrl/agent-runtime — the scripted end-to-end run.
 *
 * The T006 Work Order's determinism proof, driven through the reference
 * runtime: spawn a small hierarchy (3 instances, 1 manager), delegate,
 * publish/subscribe, challenge/propose/approve, escalate, learn, report,
 * terminate — then assert the FULL LOG REPLAYS to the identical final state.
 *
 * Every one of the fourteen kernel operations is exercised at least once
 * through the runtime (acceptance criterion 3), and the same script run
 * through two independent runtimes yields deeply equal states (acceptance
 * criterion 4, the runtime half).
 */

import { describe, expect, it } from 'vitest';

import {
  type AgentInstanceId,
  type KernelAuthority,
  type KernelOperation,
  KERNEL_ACTION_NAMES,
  agentInstanceId,
  createKernelAuthority,
  createKernelOperation,
  isDeeplyFrozen,
  isKernelEffect,
} from '../../../packages/agent-os/src/index';
import { AgentRuntime, ScriptedSource } from './index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = 'tenant-atlas' as Parameters<AgentRuntime['liveInstances']>[0];
const TS = 1_700_000_000_000;

const BOOTSTRAP = agentInstanceId('control-plane-bootstrap');
const MGR = agentInstanceId('agent-instance-atlas-0001'); // root manager
const W1 = agentInstanceId('agent-instance-research-0002'); // report 1
const W2 = agentInstanceId('agent-instance-execution-0003'); // report 2

const MANAGER_AUTHORITY: KernelAuthority = createKernelAuthority({
  allowedActions: [...KERNEL_ACTION_NAMES],
  deniedActions: [],
  maxDelegationDepth: 3,
});

const WORKER_AUTHORITY: KernelAuthority = createKernelAuthority({
  allowedActions: [
    'DELEGATE',
    'REQUEST',
    'PUBLISH',
    'SUBSCRIBE',
    'CHALLENGE',
    'PROPOSE',
    'ESCALATE',
    'OBSERVE',
    'LEARN',
    'REPORT',
  ],
  deniedActions: ['EXECUTE', 'SPAWN', 'TERMINATE', 'APPROVE'],
  maxDelegationDepth: 1,
});

const APPROVER_AUTHORITY: KernelAuthority = createKernelAuthority({
  allowedActions: ['OBSERVE', 'REPORT', 'APPROVE', 'CHALLENGE', 'REQUEST', 'SUBSCRIBE'],
  deniedActions: ['EXECUTE', 'SPAWN', 'TERMINATE', 'DELEGATE', 'PUBLISH', 'PROPOSE', 'ESCALATE', 'LEARN'],
  maxDelegationDepth: 0,
});

function spawnOp(
  opId: string,
  actor: AgentInstanceId,
  target: AgentInstanceId,
  managerId: AgentInstanceId | null,
  scope: KernelAuthority,
  timestamp: number,
): KernelOperation {
  return createKernelOperation({
    opId,
    type: 'SPAWN',
    timestamp: timestamp as never,
    actor,
    tenantId: TENANT,
    target,
    managerId,
    bodyVersionRef: 'body/atlas@1.2.0',
    substrateRef: 'acme/reasoner-2@2026.03',
    authority: scope,
  });
}

function op(opId: string, type: string, fields: Record<string, unknown>): KernelOperation {
  const base = { opId, type, tenantId: TENANT, timestamp: fields.timestamp } as Record<string, unknown>;
  switch (type) {
    case 'SUBSCRIBE':
    case 'PUBLISH':
      return createKernelOperation({
        ...base,
        actor: fields.actor,
        topic: fields.topic,
        payload: fields.payload,
      } as KernelOperation);
    case 'REQUEST':
      return createKernelOperation({
        ...base,
        actor: fields.actor,
        target: fields.target,
        payload: fields.payload,
      } as KernelOperation);
    case 'DELEGATE':
      return createKernelOperation({
        ...base,
        actor: fields.actor,
        target: fields.target,
        taskRef: fields.taskRef,
        managerChain: fields.managerChain,
      } as KernelOperation);
    case 'PROPOSE':
      return createKernelOperation({
        ...base,
        actor: fields.actor,
        target: fields.target,
        proposalRef: fields.proposalRef,
        verdict: 'proposed',
      } as KernelOperation);
    case 'CHALLENGE':
      return createKernelOperation({
        ...base,
        actor: fields.actor,
        target: fields.target,
        proposalRef: fields.proposalRef,
        verdict: 'challenged',
      } as KernelOperation);
    case 'APPROVE':
      return createKernelOperation({
        ...base,
        actor: fields.actor,
        target: fields.target,
        proposalRef: fields.proposalRef,
        verdict: 'approved',
      } as KernelOperation);
    case 'ESCALATE':
      return createKernelOperation({
        ...base,
        actor: fields.actor,
        reason: fields.reason,
        chain: fields.chain,
      } as KernelOperation);
    case 'OBSERVE':
      return createKernelOperation({ ...base, actor: fields.actor, queryRef: fields.queryRef } as KernelOperation);
    case 'LEARN':
      return createKernelOperation({ ...base, actor: fields.actor, lessonRef: fields.lessonRef } as KernelOperation);
    case 'REPORT':
      return createKernelOperation({
        ...base,
        actor: fields.actor,
        summary: fields.summary,
      } as KernelOperation);
    case 'EXECUTE':
      return createKernelOperation({
        ...base,
        actor: fields.actor,
        intentRef: fields.intentRef,
        authorityTokenRef: fields.authorityTokenRef,
      } as KernelOperation);
    case 'TERMINATE':
      return createKernelOperation({ ...base, actor: fields.actor, target: fields.target, reason: fields.reason } as KernelOperation);
    default:
      throw new Error(`scripted test: unsupported op type ${type}`);
  }
}

// ---------------------------------------------------------------------------
// The script: all fourteen operations, small hierarchy, happy path
// ---------------------------------------------------------------------------

/** The canonical script (W2 additionally carries APPROVER authority). */
function script(): readonly KernelOperation[] {
  const W2_AUTHORITY: KernelAuthority = createKernelAuthority({
    allowedActions: [...WORKER_AUTHORITY.allowedActions, ...APPROVER_AUTHORITY.allowedActions.filter((a) => a === 'APPROVE')],
    deniedActions: WORKER_AUTHORITY.deniedActions.filter((a) => a !== 'APPROVE'),
    maxDelegationDepth: 1,
  });
  return [
    // 1–3. Spawn the hierarchy: root manager + two reports (3 instances, 1 manager).
    spawnOp('op-001', BOOTSTRAP, MGR, null, MANAGER_AUTHORITY, TS),
    spawnOp('op-002', MGR, W1, MGR, WORKER_AUTHORITY, TS + 100),
    spawnOp('op-003', MGR, W2, MGR, W2_AUTHORITY, TS + 200),
    // 4–6. Publish/subscribe on an organization topic.
    op('op-004', 'SUBSCRIBE', { actor: W1, topic: 'signals.regime', payload: 'interest/regime', timestamp: TS + 300 }),
    op('op-005', 'SUBSCRIBE', { actor: W2, topic: 'signals.regime', payload: 'interest/regime', timestamp: TS + 400 }),
    op('op-006', 'PUBLISH', { actor: W1, topic: 'signals.regime', payload: 'signal/regime-shift-evidence', timestamp: TS + 500 }),
    // 7. Delegate a task down the management chain.
    op('op-007', 'DELEGATE', {
      actor: MGR,
      target: W1,
      taskRef: 'task/research-regime-shift',
      managerChain: [MGR],
      timestamp: TS + 600,
    }),
    // 8. Point-to-point request between peers.
    op('op-008', 'REQUEST', { actor: W1, target: W2, payload: 'request/confirm-position-plan', timestamp: TS + 700 }),
    // 9–11. Challenge / propose / approve around one proposal.
    op('op-009', 'PROPOSE', {
      actor: W1,
      target: MGR,
      proposalRef: 'proposal/position-plan-0007',
      timestamp: TS + 800,
    }),
    op('op-010', 'CHALLENGE', {
      actor: MGR,
      target: W1,
      proposalRef: 'proposal/position-plan-0007',
      timestamp: TS + 900,
    }),
    op('op-011', 'APPROVE', {
      actor: W2,
      target: W1,
      proposalRef: 'proposal/position-plan-0008',
      timestamp: TS + 1000,
    }),
    // 12. Escalate up the management chain.
    op('op-012', 'ESCALATE', {
      actor: W1,
      reason: 'uncertainty above decision threshold',
      chain: [W1, MGR],
      timestamp: TS + 1100,
    }),
    // 13. Observe (transport an observation query).
    op('op-013', 'OBSERVE', { actor: W1, queryRef: 'query/regime-features-asof', timestamp: TS + 1200 }),
    // 14. Learn (transport a lesson).
    op('op-014', 'LEARN', { actor: W1, lessonRef: 'lesson/overfit-signal-42', timestamp: TS + 1300 }),
    // 15. Report (transport a summary record).
    op('op-015', 'REPORT', {
      actor: W1,
      summary: { subject: W1, headline: 'Regime research complete', detailRef: 'report/doc-0001' },
      timestamp: TS + 1400,
    }),
    // 16. Execute (authority-neutral transport to the execution gate).
    op('op-016', 'EXECUTE', {
      actor: MGR,
      intentRef: 'intent/buy-0.5-btc-limit',
      authorityTokenRef: 'authz/gate-token-opaque-001',
      timestamp: TS + 1500,
    }),
    // 17. Terminate one report (manager-issued).
    op('op-017', 'TERMINATE', { actor: MGR, target: W2, reason: 'task complete', timestamp: TS + 1600 }),
  ];
}

// ---------------------------------------------------------------------------
// The scripted run
// ---------------------------------------------------------------------------

describe('scripted end-to-end run (fourteen operations, 1 manager + 2 reports)', () => {
  it('accepts the full script through the runtime without rejection', () => {
    const runtime = new AgentRuntime();
    const result = runtime.drive(new ScriptedSource(script()));
    expect(result.ok).toBe(true);
    expect(runtime.lastRejection).toBeNull();
    expect(runtime.operationLog.length).toBe(17);
  });

  it('exercises EVERY one of the fourteen kernel operations at least once', () => {
    const runtime = new AgentRuntime();
    runtime.drive(new ScriptedSource(script()));
    const kinds = new Set(runtime.operationLog.map((operation) => operation.type));
    expect([...kinds].sort()).toEqual([...KERNEL_ACTION_NAMES].slice().sort());
    expect(kinds.size).toBe(14);
  });

  it('materializes the hierarchy: 3 instances, 1 manager, 2 reports', () => {
    const runtime = new AgentRuntime();
    runtime.drive(new ScriptedSource(script()));
    const live = runtime.liveInstances(TENANT);
    expect(live.length).toBe(2); // W2 was terminated by op-017
    const manager = runtime.instance(TENANT, MGR);
    expect(manager?.managerId).toBeNull();
    expect(runtime.instance(TENANT, W1)?.managerId).toBe(MGR);
    expect(runtime.instance(TENANT, W2)).toBeNull();
  });

  it('materializes deterministic mailboxes and effects', () => {
    const runtime = new AgentRuntime();
    runtime.drive(new ScriptedSource(script()));
    // W2's mailbox: subscribe-echo? No — SUBSCRIBE produces no message; W2 received
    // the PUBLISH (as subscriber) and the REQUEST from W1. But W2 was TERMINATED —
    // termination clears the mailbox. So W2's mailbox is empty.
    expect(runtime.mailbox(TENANT, W2)).toEqual([]);
    // W1 (still live) received: the PUBLISH echo (subscriber), the DELEGATE task,
    // the CHALLENGE and the APPROVE from the proposal transport.
    const w1Topics = runtime.mailbox(TENANT, W1).map((envelope) => envelope.topic);
    expect(w1Topics).toContain('signals.regime');
    expect(w1Topics).toContain('kernel.delegate');
    expect(w1Topics).toContain('kernel.challenge');
    expect(w1Topics).toContain('kernel.approve');
    // MGR received the PROPOSE and the ESCALATION from W1.
    const mgrTopics = runtime.mailbox(TENANT, MGR).map((envelope) => envelope.topic);
    expect(mgrTopics).toContain('kernel.propose');
    expect(mgrTopics).toContain('kernel.escalate');
    // Subscribers view: W1 and W2 subscribed; W2 was removed at termination.
    expect(runtime.subscribers(TENANT, 'signals.regime' as never)).toEqual([W1]);
    // Effects: all guarded, deeply frozen, with the execution transport present.
    for (const effect of runtime.allEffects) {
      expect(isKernelEffect(effect)).toBe(true);
    }
    expect(runtime.allEffects.some((effect) => effect.kind === 'execution-transported')).toBe(true);
    expect(runtime.allEffects.some((effect) => effect.kind === 'instance-terminated')).toBe(true);
  });

  it('REPLAYS THE FULL LOG TO THE IDENTICAL FINAL STATE (determinism proof)', () => {
    const runtime = new AgentRuntime();
    runtime.drive(new ScriptedSource(script()));
    const report = runtime.verifyDeterminism();
    expect(report.replayClean).toBe(true);
    expect(report.replayError).toBeNull();
    expect(report.operationsReplayed).toBe(17);
    expect(report.liveOperations).toBe(17);
    // The kernel state itself is deeply frozen at every step.
    expect(isDeeplyFrozen(runtime.kernelState)).toBe(true);
  });

  it('two independent runtimes fed the same script reach deeply equal states', () => {
    const first = new AgentRuntime();
    const second = new AgentRuntime();
    first.drive(new ScriptedSource(script()));
    second.drive(new ScriptedSource(script()));
    expect(JSON.stringify(first.kernelState)).toBe(JSON.stringify(second.kernelState));
    expect(JSON.stringify(first.allEffects)).toBe(JSON.stringify(second.allEffects));
  });

  it('rejections surface as data and leave the log untouched', () => {
    const runtime = new AgentRuntime();
    runtime.drive(new ScriptedSource(script()));
    const before = JSON.stringify(runtime.kernelState);
    // A duplicate op id (the whole 17-op script replays the first op).
    const replay = runtime.submit(script()[0] as KernelOperation);
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.error.code).toBe('duplicate-op-id');
      expect(runtime.lastRejection?.code).toBe('duplicate-op-id');
    }
    expect(JSON.stringify(runtime.kernelState)).toBe(before);
    expect(runtime.operationLog.length).toBe(17);
  });

  it('a fresh runtime can adopt a recorded log and verify it (forensics)', () => {
    const recorded = new AgentRuntime();
    recorded.drive(new ScriptedSource(script()));
    // Re-drive the RECORDED LOG (not the script) into a fresh runtime — the
    // log is itself a valid deterministic operation source.
    const forensic = new AgentRuntime();
    forensic.drive(new ScriptedSource(recorded.operationLog));
    expect(JSON.stringify(forensic.kernelState)).toBe(JSON.stringify(recorded.kernelState));
    expect(forensic.verifyDeterminism().replayClean).toBe(true);
  });
});
