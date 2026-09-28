/**
 * @tradrl/agent-os — operation, authority and envelope contract tests.
 *
 * Guard totality over the fourteen-operation union, factory validation
 * (validity by construction), the authority mirror, envelope discipline and
 * the error taxonomy.
 */

import { describe, expect, it } from 'vitest';

import {
  type KernelAuthority,
  type KernelOperation,
  type MessageEnvelope,
  type SpawnOperation,
  PROPOSAL_VERDICTS,
  KERNEL_TOPICS,
  createKernelAuthority,
  createKernelOperation,
  createMessageEnvelope,
  isApproveOperation,
  isChallengeOperation,
  isDelegateOperation,
  isEscalateOperation,
  isExecuteOperation,
  isKernelError,
  isKernelOperation,
  isKernelTopic,
  isLearnOperation,
  isMessageEnvelope,
  isObserveOperation,
  isProposeOperation,
  isReasonText,
  isPublishOperation,
  isReportOperation,
  isRequestOperation,
  isSpawnOperation,
  isSubscribeOperation,
  isTerminateOperation,
  kernelError,
  reasonText,
  messagePayload,
  agentInstanceId,
  isDeeplyFrozen,
  isKernelErrorCode,
} from './index';

// ---------------------------------------------------------------------------
// Canonical fixtures (typed via factories, mirrored by the guards)
// ---------------------------------------------------------------------------

const ACTOR = agentInstanceId('agent-alpha');
const TARGET = agentInstanceId('agent-beta');
const TENANT = 'tenant-one';
const TS = 1_700_000_000_000;

const FULL_AUTHORITY: KernelAuthority = createKernelAuthority({
  allowedActions: [
    'SPAWN',
    'TERMINATE',
    'DELEGATE',
    'REQUEST',
    'PUBLISH',
    'SUBSCRIBE',
    'CHALLENGE',
    'PROPOSE',
    'APPROVE',
    'EXECUTE',
    'ESCALATE',
    'OBSERVE',
    'LEARN',
    'REPORT',
  ],
  deniedActions: [],
  maxDelegationDepth: 3,
});

const SPAWN: SpawnOperation = createKernelOperation({
  opId: 'op-spawn-001',
  type: 'SPAWN',
  timestamp: TS,
  actor: ACTOR,
  tenantId: TENANT,
  target: TARGET,
  managerId: null,
  bodyVersionRef: 'body/atlas@1.2.0',
  substrateRef: 'acme/reasoner-2@2026.03',
  authority: FULL_AUTHORITY,
});

/** Spreads a patch over an operation for corruption tests. */
function corrupt(op: KernelOperation | MessageEnvelope, patch: Record<string, unknown>): unknown {
  return { ...(op as unknown as Record<string, unknown>), ...patch };
}

describe('the fourteen-operation union guard', () => {
  const operations: readonly KernelOperation[] = [
    SPAWN,
    createKernelOperation({
      opId: 'op-terminate-001',
      type: 'TERMINATE',
      timestamp: TS + 1,
      actor: ACTOR,
      tenantId: TENANT,
      target: TARGET,
      reason: 'budget exhausted',
    }),
    createKernelOperation({
      opId: 'op-delegate-001',
      type: 'DELEGATE',
      timestamp: TS + 2,
      actor: ACTOR,
      tenantId: TENANT,
      target: TARGET,
      taskRef: 'task/research-regime-shift',
      managerChain: [ACTOR],
    }),
    createKernelOperation({
      opId: 'op-request-001',
      type: 'REQUEST',
      timestamp: TS + 3,
      actor: ACTOR,
      tenantId: TENANT,
      target: TARGET,
      payload: 'request/payload-ref-001',
    }),
    createKernelOperation({
      opId: 'op-publish-001',
      type: 'PUBLISH',
      timestamp: TS + 4,
      actor: ACTOR,
      tenantId: TENANT,
      topic: 'signals.regime',
      payload: 'signal/regime-shift-evidence',
    }),
    createKernelOperation({
      opId: 'op-subscribe-001',
      type: 'SUBSCRIBE',
      timestamp: TS + 5,
      actor: ACTOR,
      tenantId: TENANT,
      topic: 'signals.regime',
      payload: 'interest/regime-signals',
    }),
    createKernelOperation({
      opId: 'op-challenge-001',
      type: 'CHALLENGE',
      timestamp: TS + 6,
      actor: ACTOR,
      tenantId: TENANT,
      target: TARGET,
      proposalRef: 'proposal/open-position-plan-7',
      verdict: 'challenged',
    }),
    createKernelOperation({
      opId: 'op-propose-001',
      type: 'PROPOSE',
      timestamp: TS + 7,
      actor: ACTOR,
      tenantId: TENANT,
      target: TARGET,
      proposalRef: 'proposal/open-position-plan-8',
      verdict: 'proposed',
    }),
    createKernelOperation({
      opId: 'op-approve-001',
      type: 'APPROVE',
      timestamp: TS + 8,
      actor: ACTOR,
      tenantId: TENANT,
      target: TARGET,
      proposalRef: 'proposal/open-position-plan-8',
      verdict: 'approved',
    }),
    createKernelOperation({
      opId: 'op-execute-001',
      type: 'EXECUTE',
      timestamp: TS + 9,
      actor: ACTOR,
      tenantId: TENANT,
      intentRef: 'intent/buy-1-btc-limit',
      authorityTokenRef: 'authz/token-opaque-xyz',
    }),
    createKernelOperation({
      opId: 'op-escalate-001',
      type: 'ESCALATE',
      timestamp: TS + 10,
      actor: ACTOR,
      tenantId: TENANT,
      reason: 'uncertainty above threshold',
      chain: [ACTOR],
    }),
    createKernelOperation({
      opId: 'op-observe-001',
      type: 'OBSERVE',
      timestamp: TS + 11,
      actor: ACTOR,
      tenantId: TENANT,
      queryRef: 'query/regime-features-asof',
    }),
    createKernelOperation({
      opId: 'op-learn-001',
      type: 'LEARN',
      timestamp: TS + 12,
      actor: ACTOR,
      tenantId: TENANT,
      lessonRef: 'lesson/overfit-signal-42',
    }),
    createKernelOperation({
      opId: 'op-report-001',
      type: 'REPORT',
      timestamp: TS + 13,
      actor: ACTOR,
      tenantId: TENANT,
      summary: {
        subject: TARGET,
        headline: 'Position plan executed within limits',
        detailRef: 'report/doc-001',
      },
    }),
  ];

  it('accepts one canonical operation of EVERY one of the fourteen kinds', () => {
    expect(operations.length).toBe(14);
    for (const op of operations) {
      expect(isKernelOperation(op)).toBe(true);
    }
    const kinds = new Set(operations.map((op) => op.type));
    expect(kinds.size).toBe(14);
  });

  it('discriminates per-kind guards', () => {
    expect(isSpawnOperation(SPAWN)).toBe(true);
    expect(isTerminateOperation(operations[1])).toBe(true);
    expect(isDelegateOperation(operations[2])).toBe(true);
    expect(isRequestOperation(operations[3])).toBe(true);
    expect(isPublishOperation(operations[4])).toBe(true);
    expect(isSubscribeOperation(operations[5])).toBe(true);
    expect(isChallengeOperation(operations[6])).toBe(true);
    expect(isProposeOperation(operations[7])).toBe(true);
    expect(isApproveOperation(operations[8])).toBe(true);
    expect(isExecuteOperation(operations[9])).toBe(true);
    expect(isEscalateOperation(operations[10])).toBe(true);
    expect(isObserveOperation(operations[11])).toBe(true);
    expect(isLearnOperation(operations[12])).toBe(true);
    expect(isReportOperation(operations[13])).toBe(true);
    // Cross-kind rejection.
    expect(isTerminateOperation(SPAWN)).toBe(false);
    expect(isSpawnOperation(operations[1])).toBe(false);
  });

  it('rejects unknown verbs (the vocabulary is closed)', () => {
    expect(isKernelOperation(corrupt(SPAWN, { type: 'BANISH' }))).toBe(false);
  });

  it('rejects field corruption for every kind (total guards)', () => {
    const mutations: ReadonlyArray<(op: KernelOperation) => unknown> = [
      (op) => corrupt(op, { opId: 'bad id' }),
      (op) => corrupt(op, { timestamp: -1 }),
      (op) => corrupt(op, { timestamp: Number.NaN }),
      (op) => corrupt(op, { actor: 42 }),
      (op) => corrupt(op, { tenantId: '' }),
    ];
    for (const op of operations) {
      for (const mutate of mutations) {
        expect(isKernelOperation(mutate(op))).toBe(false);
      }
    }
    // Kind-specific corruptions.
    expect(isKernelOperation(corrupt(SPAWN, { target: 'bad id' }))).toBe(false);
    expect(isKernelOperation(corrupt(SPAWN, { managerId: 'also bad' }))).toBe(false);
    expect(isKernelOperation(corrupt(SPAWN, { authority: null }))).toBe(false);
    const terminate = operations[1] as KernelOperation;
    const delegate = operations[2] as KernelOperation;
    const request = operations[3] as KernelOperation;
    const publish = operations[4] as KernelOperation;
    const challenge = operations[6] as KernelOperation;
    const propose = operations[7] as KernelOperation;
    const approve = operations[8] as KernelOperation;
    const execute = operations[9] as KernelOperation;
    const escalate = operations[10] as KernelOperation;
    const observe = operations[11] as KernelOperation;
    const learn = operations[12] as KernelOperation;
    const report = operations[13] as KernelOperation;
    expect(isKernelOperation(corrupt(terminate, { reason: '' }))).toBe(false);
    expect(isKernelOperation(corrupt(delegate, { managerChain: 'not-a-list' }))).toBe(false);
    expect(isKernelOperation(corrupt(delegate, { taskRef: ' ' }))).toBe(false);
    expect(isKernelOperation(corrupt(request, { payload: '\u0000' }))).toBe(false);
    expect(isKernelOperation(corrupt(publish, { topic: 'bad topic!' }))).toBe(false);
    expect(isKernelOperation(corrupt(challenge, { verdict: 'approved' }))).toBe(false);
    expect(isKernelOperation(corrupt(propose, { verdict: 'rejected' }))).toBe(false);
    expect(isKernelOperation(corrupt(approve, { verdict: 'challenged' }))).toBe(false);
    expect(isKernelOperation(corrupt(execute, { authorityTokenRef: '' }))).toBe(false);
    expect(isKernelOperation(corrupt(escalate, { chain: [42] }))).toBe(false);
    expect(isKernelOperation(corrupt(observe, { queryRef: null }))).toBe(false);
    expect(isKernelOperation(corrupt(learn, { lessonRef: '' }))).toBe(false);
    expect(
      isKernelOperation(corrupt(report, { summary: { subject: 'bad id', headline: 'x', detailRef: 'y' } })),
    ).toBe(false);
    expect(
      isKernelOperation(corrupt(report, { summary: { subject: TARGET, headline: '', detailRef: 'y' } })),
    ).toBe(false);
    expect(
      isKernelOperation(corrupt(report, { summary: { subject: TARGET, headline: 'x', detailRef: '' } })),
    ).toBe(false);
  });

  it('rejects non-plain records (class instances never pass as operations)', () => {
    class FakeSpawn {
      public opId = 'op-x';
      public type = 'SPAWN';
    }
    expect(isSpawnOperation(new FakeSpawn())).toBe(false);
    expect(isKernelOperation(new FakeSpawn())).toBe(false);
    expect(isKernelOperation(null)).toBe(false);
    expect(isKernelOperation(undefined)).toBe(false);
    expect(isKernelOperation(42)).toBe(false);
    expect(isKernelOperation([SPAWN])).toBe(false);
  });

  it('produces deeply frozen operations from the factory', () => {
    expect(isDeeplyFrozen(SPAWN)).toBe(true);
    for (const op of operations) {
      expect(isDeeplyFrozen(op)).toBe(true);
    }
  });
});

describe('createKernelOperation factory', () => {
  it('throws field-prefixed TypeErrors on invalid input', () => {
    expect(() => createKernelOperation(corrupt(SPAWN, { opId: 'bad id' }) as SpawnOperation)).toThrow(/opId/);
    expect(() => createKernelOperation(corrupt(SPAWN, { timestamp: -1 }) as SpawnOperation)).toThrow(/timestamp/);
    expect(() => createKernelOperation(corrupt(SPAWN, { actor: '' }) as SpawnOperation)).toThrow(/actor/);
    expect(() => createKernelOperation(corrupt(SPAWN, { authority: null }) as SpawnOperation)).toThrow(
      /type-specific fields/,
    );
  });
});

describe('KernelAuthority', () => {
  it('creates deeply frozen authorities and validates structure', () => {
    expect(isDeeplyFrozen(FULL_AUTHORITY)).toBe(true);
    const readOnly = createKernelAuthority({
      allowedActions: ['OBSERVE', 'SUBSCRIBE', 'REPORT'],
      deniedActions: ['EXECUTE', 'SPAWN'],
      maxDelegationDepth: 0,
    });
    expect(readOnly.allowedActions).toEqual(['OBSERVE', 'SUBSCRIBE', 'REPORT']);
    expect(readOnly.maxDelegationDepth).toBe(0);
  });

  it('rejects allowed/denied contradictions and duplicates', () => {
    expect(() =>
      createKernelAuthority({
        allowedActions: ['OBSERVE'],
        deniedActions: ['OBSERVE'],
        maxDelegationDepth: 0,
      }),
    ).toThrow(/OBSERVE is also denied/);
    expect(() =>
      createKernelAuthority({
        allowedActions: ['OBSERVE', 'OBSERVE'],
        deniedActions: [],
        maxDelegationDepth: 0,
      }),
    ).toThrow(/duplicate action/);
    expect(() =>
      createKernelAuthority({
        allowedActions: ['OBSERVE'],
        deniedActions: ['LEARN', 'LEARN'],
        maxDelegationDepth: 0,
      }),
    ).toThrow(/duplicate action/);
  });
});

describe('proposal verdicts and reason text', () => {
  it('enumerates the closed verdict set', () => {
    expect([...PROPOSAL_VERDICTS]).toEqual(['proposed', 'challenged', 'approved', 'rejected']);
  });

  it('bounds reason text', () => {
    expect(isReasonText(reasonText('budget exhausted'))).toBe(true);
    expect(isReasonText('')).toBe(false);
    expect(isReasonText('   ')).toBe(false);
    expect(isReasonText(`x${'y'.repeat(600)}`)).toBe(false);
    expect(isReasonText('no\x00control')).toBe(false);
    expect(() => reasonText('')).toThrow(/ReasonText/);
  });
});

describe('message envelopes', () => {
  const ENVELOPE: MessageEnvelope = createMessageEnvelope({
    id: 'msg:op-1:agent-alpha:1',
    topic: 'signals.regime',
    tenantId: TENANT,
    sender: ACTOR,
    payload: messagePayload('signal/ref-001'),
    sequence: 1,
    causalityId: 'op-1',
    publishedAt: TS,
  });

  it('creates deeply frozen envelopes', () => {
    expect(isMessageEnvelope(ENVELOPE)).toBe(true);
    expect(isDeeplyFrozen(ENVELOPE)).toBe(true);
  });

  it('rejects corrupt envelopes', () => {
    expect(isMessageEnvelope(corrupt(ENVELOPE, { sequence: 0 }))).toBe(false);
    expect(isMessageEnvelope(corrupt(ENVELOPE, { sequence: 1.5 }))).toBe(false);
    expect(isMessageEnvelope(corrupt(ENVELOPE, { causalityId: 42 }))).toBe(false);
    expect(isMessageEnvelope(corrupt(ENVELOPE, { publishedAt: -1 }))).toBe(false);
    expect(isMessageEnvelope(corrupt(ENVELOPE, { payload: '' }))).toBe(false);
    expect(isMessageEnvelope(null)).toBe(false);
  });

  it('throws field-prefixed errors from the factory', () => {
    expect(() => createMessageEnvelope(corrupt(ENVELOPE, { sequence: 0 }) as MessageEnvelope)).toThrow(
      /sequence/,
    );
    expect(() => createMessageEnvelope(corrupt(ENVELOPE, { id: 'bad id\x01' }) as MessageEnvelope)).toThrow(
      /id/,
    );
  });

  it('reserves the kernel topic namespace', () => {
    expect(KERNEL_TOPICS.length).toBe(7);
    for (const topic of KERNEL_TOPICS) {
      expect(isKernelTopic(topic)).toBe(true);
    }
    expect(isKernelTopic('signals.regime')).toBe(false);
  });
});

describe('error taxonomy', () => {
  it('produces deeply frozen error records with valid codes', () => {
    const error = kernelError('cross-tenant', 'actor belongs to another tenant');
    expect(isKernelError(error)).toBe(true);
    expect(isDeeplyFrozen(error)).toBe(true);
    expect(error.code).toBe('cross-tenant');
  });

  it('covers the frozen T006 taxonomy entries', () => {
    const frozenSix: readonly string[] = [
      'unknown-instance',
      'cross-tenant',
      'not-subscribed',
      'circular-delegation-chain',
      'duplicate-op-id',
      'monotonicity-violation',
    ];
    for (const code of frozenSix) {
      expect(isKernelErrorCode(code)).toBe(true);
    }
  });

  it('rejects unknown codes at construction', () => {
    expect(() => kernelError('not-a-code' as never, 'x')).toThrow(/unknown code/);
    expect(() => kernelError('cross-tenant', '')).toThrow(/message/);
  });
});
