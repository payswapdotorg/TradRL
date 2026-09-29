// @tradrl/body-trading-director — publication tests (the agent-os
// envelope mirror: derived ids, the kernel topic reservation, the
// payload binding law; the DirectorPublicationPort — PUBLISH/SUBSCRIBE/
// REPORT only, with the port-authority L8 trip-wire; the recording
// port).

import { describe, expect, it } from 'vitest';
import { type DirectorDecision, type EscalationRecord } from './decision';
import {
  type DirectorPublication,
  type DirectorReport,
  type DirectorSubscription,
  buildDirectorDecisionPublication,
  buildDirectorEscalationPublication,
  createRecordingDirectorPort,
  decisionRefOf,
  escalationRefOf,
  isDirectorPublication,
  isDirectorPublicationPort,
  isDirectorReport,
  isDirectorSubscription,
  isKernelTopicMirror,
  isMessageEnvelopeMirror,
  portAuthorityViolations,
  validateDirectorPublication,
  validateDirectorReport,
  validateDirectorSubscription,
  KERNEL_TOPICS_MIRROR,
} from './publication';
import {
  type AgentInstanceId,
  type TopicName,
  type TenantId,
} from './ids';
import {
  FIXTURE_DECISION_TOPIC,
  FIXTURE_ESCALATION_TOPIC,
  FIXTURE_GOLDEN_DECISION,
  FIXTURE_PROJECT,
  FIXTURE_QUORUM_UNMET_ESCALATION,
  FIXTURE_REGISTRY,
  FIXTURE_SENDER,
  FIXTURE_TENANT,
} from './fixtures';
import { composeDirectorDecision } from './synthesis';
import { FIXTURE_QUORUM_MET_INPUT, FIXTURE_QUORUM_UNMET_INPUT } from './fixtures';

const GOLDEN_DECISION: DirectorDecision = FIXTURE_GOLDEN_DECISION.kind === 'decision' ? FIXTURE_GOLDEN_DECISION.decision : panic('golden decision missing');
const GOLDEN_ESCALATION: EscalationRecord = FIXTURE_QUORUM_UNMET_ESCALATION.kind === 'escalation' ? FIXTURE_QUORUM_UNMET_ESCALATION.escalation : panic('golden escalation missing');
function panic(message: string): never {
  throw new Error(message);
}

describe('the kernel topic reservation', () => {
  it('the seven reserved topics', () => {
    expect([...KERNEL_TOPICS_MIRROR]).toEqual([
      'kernel.request',
      'kernel.delegate',
      'kernel.challenge',
      'kernel.propose',
      'kernel.approve',
      'kernel.escalate',
      'kernel.cascade-escalate',
    ]);
    expect(isKernelTopicMirror('kernel.escalate')).toBe(true);
    expect(isKernelTopicMirror('directors.decisions')).toBe(false);
  });
});

describe('publication construction (the kernel\'s exact id formula)', () => {
  it('builds a decision publication with the derived envelope id and bound payload', () => {
    const construction = buildDirectorDecisionPublication({
      opId: 'op-director-0001',
      topic: FIXTURE_DECISION_TOPIC as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      decision: GOLDEN_DECISION,
      sequence: 1,
      publishedAt: GOLDEN_DECISION.asOf,
    });
    expect(construction.ok).toBe(true);
    if (!construction.ok) throw new Error('must build');
    expect(construction.value.envelope.id).toBe(`msg:op-director-0001:${FIXTURE_SENDER}:1`);
    expect(construction.value.envelope.payload).toBe(`decision:${GOLDEN_DECISION.decisionId}`);
    expect(construction.value.envelope.causalityId).toBe('op-director-0001');
    expect(construction.value.envelope.publishedAt).toBe(GOLDEN_DECISION.asOf);
    expect(isMessageEnvelopeMirror(construction.value.envelope)).toBe(true);
    expect(isDirectorPublication(construction.value)).toBe(true);
  });

  it('builds an escalation publication with the derived envelope id and bound payload', () => {
    const construction = buildDirectorEscalationPublication({
      opId: 'op-director-0002',
      topic: FIXTURE_ESCALATION_TOPIC as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      escalation: GOLDEN_ESCALATION,
      sequence: 2,
      causalityId: 'op-cause-0002',
      publishedAt: GOLDEN_ESCALATION.asOf,
    });
    expect(construction.ok).toBe(true);
    if (!construction.ok) throw new Error('must build');
    expect(construction.value.envelope.id).toBe(`msg:op-director-0002:${FIXTURE_SENDER}:2`);
    expect(construction.value.envelope.payload).toBe(`escalation:${GOLDEN_ESCALATION.escalationId}`);
    expect(construction.value.envelope.causalityId).toBe('op-cause-0002');
  });

  it('a reserved kernel topic is refused at construction (reserved_publication_topic)', () => {
    const construction = buildDirectorDecisionPublication({
      opId: 'op-director-0003',
      topic: 'kernel.approve' as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      decision: GOLDEN_DECISION,
      sequence: 3,
      publishedAt: GOLDEN_DECISION.asOf,
    });
    expect(construction.ok).toBe(false);
    if (!construction.ok) {
      expect(construction.errors.map((e) => e.code)).toContain('reserved_publication_topic');
    }
  });

  it('malformed envelope material is refused as typed data (never throws)', () => {
    const construction = buildDirectorDecisionPublication({
      opId: '',
      topic: FIXTURE_DECISION_TOPIC as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      decision: GOLDEN_DECISION,
      sequence: 0,
      publishedAt: GOLDEN_DECISION.asOf,
    });
    expect(construction.ok).toBe(false);
  });
});

describe('the payload binding law (unstructured_publication)', () => {
  it('a well-formed publication validates under the port discipline', () => {
    const construction = buildDirectorDecisionPublication({
      opId: 'op-director-0004',
      topic: FIXTURE_DECISION_TOPIC as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      decision: GOLDEN_DECISION,
      sequence: 4,
      publishedAt: GOLDEN_DECISION.asOf,
    });
    if (!construction.ok) throw new Error('must build');
    expect(validateDirectorPublication(construction.value, FIXTURE_REGISTRY)).toEqual([]);
  });

  it('a payload not bound to the carried record is unstructured_publication', () => {
    const construction = buildDirectorDecisionPublication({
      opId: 'op-director-0005',
      topic: FIXTURE_DECISION_TOPIC as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      decision: GOLDEN_DECISION,
      sequence: 5,
      publishedAt: GOLDEN_DECISION.asOf,
    });
    if (!construction.ok) throw new Error('must build');
    const carried = 'decision' in construction.value ? construction.value.decision : GOLDEN_DECISION;
    const tampered: DirectorPublication = {
      envelope: { ...construction.value.envelope, payload: 'decision:dd-0000000000000000' },
      decision: carried,
    } as DirectorPublication;
    const errors = validateDirectorPublication(tampered, FIXTURE_REGISTRY);
    expect(errors.map((e) => e.code)).toContain('unstructured_publication');
    expect(errors[0]?.path).toBe('envelope.payload');
  });

  it('a free-text (non-record) publication is refused', () => {
    const errors = validateDirectorPublication({ envelope: null, decision: null }, FIXTURE_REGISTRY);
    expect(errors.map((e) => e.code)).toContain('invalid_type');
  });

  it('a tenant mismatch between envelope and record is the tenant law', () => {
    const construction = buildDirectorDecisionPublication({
      opId: 'op-director-0006',
      topic: FIXTURE_DECISION_TOPIC as TopicName,
      tenantId: 'tenant-foreign' as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      decision: GOLDEN_DECISION,
      sequence: 6,
      publishedAt: GOLDEN_DECISION.asOf,
    });
    if (!construction.ok) throw new Error('must build');
    const errors = validateDirectorPublication(construction.value, FIXTURE_REGISTRY);
    expect(errors.map((e) => e.code)).toContain('tenant_missing');
  });
});

describe('SUBSCRIBE and REPORT discipline', () => {
  it('a valid subscription validates; a kernel topic is refused', () => {
    const subscription: DirectorSubscription = {
      topic: 'research.sentiment' as TopicName,
      subscriber: FIXTURE_SENDER as AgentInstanceId,
      tenantId: FIXTURE_TENANT as TenantId,
    };
    expect(isDirectorSubscription(subscription)).toBe(true);
    expect(validateDirectorSubscription(subscription)).toEqual([]);
    const reserved: DirectorSubscription = { ...subscription, topic: 'kernel.escalate' as TopicName };
    const errors = validateDirectorSubscription(reserved);
    expect(errors.map((e) => e.code)).toContain('reserved_publication_topic');
  });

  it('a valid REPORT validates; an invalid decision is refused', () => {
    const report: DirectorReport = {
      opId: 'op-director-report-0001',
      topic: 'directors.reports' as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      sequence: 1,
      publishedAt: GOLDEN_DECISION.asOf,
      decision: GOLDEN_DECISION,
    };
    expect(isDirectorReport(report)).toBe(true);
    expect(validateDirectorReport(report, FIXTURE_REGISTRY)).toEqual([]);
    const tamperedReport: DirectorReport = {
      ...report,
      decision: { ...GOLDEN_DECISION, tenantId: 'tenant-foreign' } as never,
    };
    const errors = validateDirectorReport(tamperedReport, FIXTURE_REGISTRY);
    expect(errors.map((e) => e.code)).toContain('unstructured_publication');
    expect(errors.map((e) => e.code)).toContain('tenant_missing');
  });
});

describe('THE PORT (PUBLISH/SUBSCRIBE/REPORT only — the L8 seam law)', () => {
  it('the recording port satisfies the structural guard and the port authority law', () => {
    const port = createRecordingDirectorPort();
    expect(isDirectorPublicationPort(port)).toBe(true);
    expect(portAuthorityViolations(port)).toEqual([]);
  });

  it('A PORT EXPOSING AN EXECUTE-SHAPED MEMBER IS execution_authority_granted (the L8 trip-wire)', () => {
    const port = createRecordingDirectorPort() as unknown as Record<string, unknown>;
    const doctored = { ...port, executeOrder: (order: unknown) => order };
    const errors = portAuthorityViolations(doctored);
    expect(errors.map((e) => e.code)).toContain('execution_authority_granted');
    expect(errors[0]?.path).toBe('port.executeOrder');
    expect(errors[0]?.message).toContain('T025');
  });

  it('publish, subscribe and report record their operations (deterministic recording)', () => {
    const port = createRecordingDirectorPort();
    const construction = buildDirectorDecisionPublication({
      opId: 'op-director-0007',
      topic: FIXTURE_DECISION_TOPIC as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      decision: GOLDEN_DECISION,
      sequence: 7,
      publishedAt: GOLDEN_DECISION.asOf,
    });
    if (!construction.ok) throw new Error('must build');
    const receipt = port.publish(construction.value);
    expect(receipt.ok).toBe(true);
    if (receipt.ok) {
      expect(receipt.value.envelopeId).toBe(`msg:op-director-0007:${FIXTURE_SENDER}:7`);
      expect(receipt.value.recordRef).toBe(`decision:${GOLDEN_DECISION.decisionId}`);
    }
    const subscriptionReceipt = port.subscribe({
      topic: 'research.regime' as TopicName,
      subscriber: FIXTURE_SENDER as AgentInstanceId,
      tenantId: FIXTURE_TENANT as TenantId,
    });
    expect(subscriptionReceipt.ok).toBe(true);
    const reportReceipt = port.report({
      opId: 'op-director-report-0002',
      topic: 'directors.reports' as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      sequence: 2,
      publishedAt: GOLDEN_DECISION.asOf,
      decision: GOLDEN_DECISION,
    });
    expect(reportReceipt.ok).toBe(true);
    if (reportReceipt.ok) {
      expect(reportReceipt.value.operation).toBe('REPORT');
      expect(reportReceipt.value.decisionRef).toBe(decisionRefOf(GOLDEN_DECISION));
    }
    expect(port.published).toHaveLength(1);
    expect(port.subscribed).toHaveLength(1);
    expect(port.reported).toHaveLength(1);
    // the live accessors keep recording (the recording-port trap)
    port.subscribe({
      topic: 'research.fundamental' as TopicName,
      subscriber: FIXTURE_SENDER as AgentInstanceId,
      tenantId: FIXTURE_TENANT as TenantId,
    });
    expect(port.subscribed).toHaveLength(2);
  });

  it('a kernel-topic subscription is refused by the recording port', () => {
    const port = createRecordingDirectorPort();
    const receipt = port.subscribe({
      topic: 'kernel.escalate' as TopicName,
      subscriber: FIXTURE_SENDER as AgentInstanceId,
      tenantId: FIXTURE_TENANT as TenantId,
    });
    expect(receipt.ok).toBe(false);
    if (!receipt.ok) {
      expect(receipt.errors.map((e) => e.code)).toContain('reserved_publication_topic');
    }
    expect(port.subscribed).toHaveLength(0);
  });
});

describe('the full publication chain over the composition', () => {
  it('a composed decision publishes through the port end to end', () => {
    const outcome = composeDirectorDecision(FIXTURE_QUORUM_MET_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.value.kind !== 'decision') throw new Error('must decide');
    const port = createRecordingDirectorPort();
    const construction = buildDirectorDecisionPublication({
      opId: 'op-director-chain-0001',
      topic: FIXTURE_DECISION_TOPIC as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      decision: outcome.value.decision,
      sequence: 1,
      publishedAt: outcome.value.decision.asOf,
    });
    if (!construction.ok) throw new Error('must build');
    expect(validateDirectorPublication(construction.value, FIXTURE_REGISTRY)).toEqual([]);
    expect(port.publish(construction.value).ok).toBe(true);
  });

  it('a composed escalation publishes through the port end to end', () => {
    const outcome = composeDirectorDecision(FIXTURE_QUORUM_UNMET_INPUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.value.kind !== 'escalation') throw new Error('must escalate');
    const port = createRecordingDirectorPort();
    const construction = buildDirectorEscalationPublication({
      opId: 'op-director-chain-0002',
      topic: FIXTURE_ESCALATION_TOPIC as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      escalation: outcome.value.escalation,
      sequence: 2,
      publishedAt: outcome.value.escalation.asOf,
    });
    if (!construction.ok) throw new Error('must build');
    expect(validateDirectorPublication(construction.value, FIXTURE_REGISTRY)).toEqual([]);
    expect(port.publish(construction.value).ok).toBe(true);
    expect(escalationRefOf(outcome.value.escalation)).toBe(`escalation:${outcome.value.escalation.escalationId}`);
  });
});

void FIXTURE_PROJECT;
