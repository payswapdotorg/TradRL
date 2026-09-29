// @tradrl/body-execution — publication tests: the agent-os envelope
// mirror, the payload-binding discipline, THE PORT AUTHORITY LAW
// (PUBLISH/SUBSCRIBE/REQUEST/REPORT/ESCALATE only), the gateway
// request record (the submission seam).

import { describe, expect, it } from 'vitest';
import { type TopicName, type AgentInstanceId } from './ids';
import type { TimestampMs } from './primitives';
import {
  GATEWAY_REQUEST_KINDS,
  KERNEL_TOPICS_MIRROR,
  PORT_OPERATIONS,
  buildEscalationPublication,
  buildLifecyclePublication,
  buildReconciliationPublication,
  createGatewayRequest,
  createRecordingExecutionPort,
  escalationRefOf,
  expectedGatewayRequestRef,
  isExecutionPublication,
  isExecutionPublicationPort,
  isExecutionReport,
  isExecutionSubscription,
  isGatewayRequest,
  isGatewayRequestKind,
  isKernelTopicMirror,
  isMessageEnvelopeMirror,
  lifecycleRefOf,
  portAuthorityViolations,
  reconciliationRefOf,
  serializeExecutionPublication,
  validateExecutionPublication,
  validateExecutionReport,
  validateExecutionSubscription,
  validateGatewayRequest,
} from './publication';
import {
  FIXTURE_HAPPY_PATH,
  FIXTURE_KILL_SWITCH_ESCALATION,
  FIXTURE_RECONCILED,
  FIXTURE_REGISTRY,
  FIXTURE_STUCK_ACK_ESCALATION,
  FIXTURE_TENANT,
  FIXTURE_CLOCKS,
  FIXTURE_DECISION_ID,
  FIXTURE_ORDER_REF,
  FIXTURE_RECONCILIATION_GAP,
} from './fixtures';

const SENDER = 'agent-instance-execution-0001' as AgentInstanceId;
const TOPIC_LIFECYCLE = 'execution.lifecycle-reports' as TopicName;
const TOPIC_ESCALATIONS = 'execution.escalations' as TopicName;
const TOPIC_VERDICTS = 'execution.gateway-verdicts' as TopicName;
const PUB_AT = 1_700_000_003_000 as TimestampMs;

describe('the envelope mirror + the kernel topic reservation', () => {
  it('KERNEL_TOPICS_MIRROR matches the agent-os reservation kind-for-kind', () => {
    expect([...KERNEL_TOPICS_MIRROR]).toEqual([
      'kernel.request', 'kernel.delegate', 'kernel.challenge', 'kernel.propose', 'kernel.approve', 'kernel.escalate', 'kernel.cascade-escalate',
    ]);
    expect(isKernelTopicMirror('kernel.escalate')).toBe(true);
    expect(isKernelTopicMirror('execution.escalations')).toBe(false);
  });

  it('a valid envelope passes the mirror guard; junk does not', () => {
    const envelope = {
      id: `msg:op-1:${SENDER}:1`,
      topic: TOPIC_LIFECYCLE,
      tenantId: FIXTURE_TENANT,
      sender: SENDER,
      payload: 'lifecycle:ol-0123456789abcdef',
      sequence: 1,
      causalityId: 'op-1',
      publishedAt: PUB_AT,
    };
    expect(isMessageEnvelopeMirror(envelope)).toBe(true);
    expect(isMessageEnvelopeMirror({ ...envelope, payload: 'has space' })).toBe(false);
    expect(isMessageEnvelopeMirror({ ...envelope, sequence: 0 })).toBe(false);
    expect(isMessageEnvelopeMirror({ ...envelope, publishedAt: -1 })).toBe(false);
    expect(isMessageEnvelopeMirror(null)).toBe(false);
  });
});

describe('the payload-binding discipline (typed, never silent)', () => {
  it('a lifecycle publication builds with the payload bound to the record id', () => {
    const record = FIXTURE_HAPPY_PATH.records[0] as (typeof FIXTURE_HAPPY_PATH.records)[number];
    const built = buildLifecyclePublication({
      opId: 'op-lifecycle-1',
      topic: TOPIC_LIFECYCLE,
      tenantId: FIXTURE_TENANT,
      sender: SENDER,
      record,
      sequence: 1,
      publishedAt: PUB_AT,
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.envelope.payload).toBe(lifecycleRefOf(record));
      expect(built.value.envelope.id).toBe(`msg:op-lifecycle-1:${SENDER}:1`);
      expect(validateExecutionPublication(built.value, FIXTURE_REGISTRY)).toEqual([]);
      expect(isExecutionPublication(built.value)).toBe(true);
    }
  });

  it('an escalation publication builds and validates; the reserved topic is refused', () => {
    const escalation = FIXTURE_STUCK_ACK_ESCALATION;
    expect(escalation).not.toBeNull();
    if (escalation !== null) {
      const built = buildEscalationPublication({
        opId: 'op-escalation-1',
        topic: TOPIC_ESCALATIONS,
        tenantId: FIXTURE_TENANT,
        sender: SENDER,
        escalation,
        sequence: 2,
        publishedAt: PUB_AT,
      });
      expect(built.ok).toBe(true);
      if (built.ok) {
        expect(built.value.envelope.payload).toBe(escalationRefOf(escalation));
        expect(validateExecutionPublication(built.value, FIXTURE_REGISTRY)).toEqual([]);
      }
      const reserved = buildEscalationPublication({
        opId: 'op-escalation-2',
        topic: 'kernel.escalate' as TopicName,
        tenantId: FIXTURE_TENANT,
        sender: SENDER,
        escalation,
        sequence: 3,
        publishedAt: PUB_AT,
      });
      expect(reserved.ok).toBe(false);
      if (!reserved.ok) expect(reserved.errors[0]?.code).toBe('reserved_publication_topic');
    }
  });

  it('a reconciliation publication builds with its bound payload', () => {
    const record = FIXTURE_RECONCILED.outcome.record;
    const built = buildReconciliationPublication({
      opId: 'op-recon-1',
      topic: TOPIC_LIFECYCLE,
      tenantId: FIXTURE_TENANT,
      sender: SENDER,
      reconciliation: record,
      sequence: 3,
      publishedAt: PUB_AT,
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.envelope.payload).toBe(reconciliationRefOf(record));
      expect(validateExecutionPublication(built.value, FIXTURE_REGISTRY)).toEqual([]);
    }
  });

  it('an unbound payload is unstructured_publication; an invalid record fails too', () => {
    const record = FIXTURE_HAPPY_PATH.records[0] as (typeof FIXTURE_HAPPY_PATH.records)[number];
    const built = buildLifecyclePublication({
      opId: 'op-x',
      topic: TOPIC_LIFECYCLE,
      tenantId: FIXTURE_TENANT,
      sender: SENDER,
      record,
      sequence: 1,
      publishedAt: PUB_AT,
    });
    if (!built.ok) throw new Error('must build');
    const unbound = {
      envelope: { ...built.value.envelope, payload: 'lifecycle:ol-different-record' },
      lifecycle: (built.value as { lifecycle: typeof record }).lifecycle,
    };
    const errors = validateExecutionPublication(unbound, FIXTURE_REGISTRY);
    expect(errors.some((e) => e.code === 'unstructured_publication')).toBe(true);
    // an invalid record (float quantity) is refused
    const badRecord = JSON.parse(JSON.stringify(record));
    badRecord.quantity = 0.75;
    expect(validateExecutionPublication({ envelope: built.value.envelope, lifecycle: badRecord }, FIXTURE_REGISTRY).length).toBeGreaterThan(0);
    // a tenant mismatch is tenant_missing
    const otherTenant = {
      envelope: { ...built.value.envelope, tenantId: 'tenant-beta' },
      lifecycle: (built.value as { lifecycle: typeof record }).lifecycle,
    };
    expect(validateExecutionPublication(otherTenant, FIXTURE_REGISTRY).some((e) => e.code === 'tenant_missing')).toBe(true);
    expect(serializeExecutionPublication(built.value)).toBe(serializeExecutionPublication(JSON.parse(JSON.stringify(built.value))));
  });
});

describe('THE GATEWAY REQUEST (the submission seam)', () => {
  it('the request kinds; the derived gwr- ref; validation + freezing', () => {
    expect([...GATEWAY_REQUEST_KINDS]).toEqual(['order-submission', 'cancel-submission']);
    expect(isGatewayRequestKind('order-submission')).toBe(true);
    expect(isGatewayRequestKind('execution')).toBe(false);
    const prepared = FIXTURE_HAPPY_PATH.records[0] as (typeof FIXTURE_HAPPY_PATH.records)[number];
    const request = createGatewayRequest({
      kind: 'order-submission',
      orderRef: FIXTURE_ORDER_REF,
      decisionRef: FIXTURE_DECISION_ID,
      record: prepared,
      orderClock: FIXTURE_CLOCKS.submit as TimestampMs,
      tenant: FIXTURE_TENANT,
      project: 'project-one',
    });
    expect(request.ok).toBe(true);
    if (request.ok) {
      expect(request.value.requestRef).toMatch(/^gwr-[0-9a-f]{16}$/);
      expect(request.value.requestRef).toBe(expectedGatewayRequestRef(request.value));
      expect(isGatewayRequest(request.value)).toBe(true);
    }
  });

  it('a request without the approving decision ref is decision_not_approved (the authority travels with the request)', () => {
    const prepared = FIXTURE_HAPPY_PATH.records[0] as (typeof FIXTURE_HAPPY_PATH.records)[number];
    const errors = validateGatewayRequest({
      kind: 'order-submission',
      orderRef: FIXTURE_ORDER_REF,
      decisionRef: 'not-a-decision',
      record: prepared,
      orderClock: FIXTURE_CLOCKS.submit as TimestampMs,
      tenant: FIXTURE_TENANT,
      project: 'project-one',
    });
    expect(errors.some((e) => e.code === 'decision_not_approved')).toBe(true);
    const bad = validateGatewayRequest(null);
    expect(bad[0]?.code).toBe('invalid_type');
  });
});

describe('THE PORT (PUBLISH/SUBSCRIBE/REQUEST/REPORT/ESCALATE only)', () => {
  it('the closed operation set; the recording port satisfies the guard and the authority law', () => {
    expect([...PORT_OPERATIONS]).toEqual(['PUBLISH', 'SUBSCRIBE', 'REQUEST', 'REPORT', 'ESCALATE']);
    const port = createRecordingExecutionPort();
    expect(isExecutionPublicationPort(port)).toBe(true);
    expect(portAuthorityViolations(port)).toEqual([]);
  });

  it('THE PORT AUTHORITY LAW: an execute-shaped member is the typed execution_authority_granted', () => {
    const port = createRecordingExecutionPort() as unknown as Record<string, unknown>;
    const doctored = { ...port, executeOrder: () => 'never', placeOrder: () => 'never', venueDirect: () => 'never' };
    const violations = portAuthorityViolations(doctored);
    expect(violations).toHaveLength(3);
    expect(violations.every((v) => v.code === 'execution_authority_granted')).toBe(true);
    expect(violations[0]?.message).toContain('PUBLISH/SUBSCRIBE/REQUEST/REPORT/ESCALATE only');
    expect(portAuthorityViolations('not-a-port')[0]?.code).toBe('invalid_type');
  });

  it('the recording port records every accepted operation (deterministic, no clock, no randomness)', () => {
    const port = createRecordingExecutionPort();
    const record = FIXTURE_HAPPY_PATH.records[0] as (typeof FIXTURE_HAPPY_PATH.records)[number];
    const built = buildLifecyclePublication({
      opId: 'op-1',
      topic: TOPIC_LIFECYCLE,
      tenantId: FIXTURE_TENANT,
      sender: SENDER,
      record,
      sequence: 1,
      publishedAt: PUB_AT,
    });
    if (!built.ok) throw new Error('must build');
    expect(port.publish(built.value).ok).toBe(true);
    expect(port.subscribe({ topic: TOPIC_VERDICTS, subscriber: SENDER, tenantId: FIXTURE_TENANT }).ok).toBe(true);
    const request = createGatewayRequest({
      kind: 'order-submission',
      orderRef: FIXTURE_ORDER_REF,
      decisionRef: FIXTURE_DECISION_ID,
      record,
      orderClock: FIXTURE_CLOCKS.submit as TimestampMs,
      tenant: FIXTURE_TENANT,
      project: 'project-one',
    });
    if (!request.ok) throw new Error('request must build');
    const receipt = port.request(request.value);
    expect(receipt.ok).toBe(true);
    if (receipt.ok) {
      expect(receipt.value.operation).toBe('REQUEST');
      expect(receipt.value.kind).toBe('order-submission');
    }
    expect(port.report({
      opId: 'op-report-1',
      topic: TOPIC_LIFECYCLE,
      tenantId: FIXTURE_TENANT,
      sender: SENDER,
      sequence: 2,
      publishedAt: PUB_AT,
      log: FIXTURE_HAPPY_PATH,
    }).ok).toBe(true);
    const escalation = FIXTURE_KILL_SWITCH_ESCALATION;
    if (escalation !== null) {
      expect(port.escalate({
        opId: 'op-escalate-1',
        topic: TOPIC_ESCALATIONS,
        tenantId: FIXTURE_TENANT,
        sender: SENDER,
        escalation,
        sequence: 3,
        publishedAt: PUB_AT,
      }).ok).toBe(true);
      expect(port.escalated).toHaveLength(1);
    }
    expect(port.published).toHaveLength(1);
    expect(port.subscribed).toHaveLength(1);
    expect(port.requested).toHaveLength(1);
    expect(port.reported).toHaveLength(1);
    // invalid operations are refused typed
    expect(port.publish({ envelope: 'x' } as never).ok).toBe(false);
    expect(port.subscribe({ topic: 'kernel.escalate' as TopicName, subscriber: SENDER, tenantId: FIXTURE_TENANT }).ok).toBe(false);
  });
});

describe('the subscription + report validators', () => {
  it('subscriptions must address organization topics', () => {
    expect(isExecutionSubscription({ topic: TOPIC_VERDICTS, subscriber: SENDER, tenantId: FIXTURE_TENANT })).toBe(true);
    expect(validateExecutionSubscription({ topic: TOPIC_VERDICTS, subscriber: SENDER, tenantId: FIXTURE_TENANT })).toEqual([]);
    expect(validateExecutionSubscription({ topic: 'kernel.request' as TopicName, subscriber: SENDER, tenantId: FIXTURE_TENANT })[0]?.code).toBe('reserved_publication_topic');
    expect(validateExecutionSubscription('nope')[0]?.code).toBe('invalid_type');
  });

  it('reports carry a valid lifecycle LOG (facts, never order authority)', () => {
    const report = {
      opId: 'op-report-1',
      topic: TOPIC_LIFECYCLE,
      tenantId: FIXTURE_TENANT,
      sender: SENDER,
      sequence: 1,
      publishedAt: PUB_AT,
      log: FIXTURE_HAPPY_PATH,
    };
    expect(isExecutionReport(report)).toBe(true);
    expect(validateExecutionReport(report, FIXTURE_REGISTRY)).toEqual([]);
    const reserved = { ...report, topic: 'kernel.approve' as TopicName };
    expect(validateExecutionReport(reserved, FIXTURE_REGISTRY)[0]?.code).toBe('reserved_publication_topic');
    const broken = { ...report, log: { orderRef: FIXTURE_ORDER_REF, records: [] } };
    expect(validateExecutionReport(broken, FIXTURE_REGISTRY).some((e) => e.code === 'unstructured_publication')).toBe(true);
    const tenantMismatch = { ...report, tenantId: 'tenant-beta' };
    expect(validateExecutionReport(tenantMismatch, FIXTURE_REGISTRY).some((e) => e.code === 'tenant_missing')).toBe(true);
  });

  it('the gap-scenario reconciliation record publishes too (the gap is a published fact)', () => {
    const record = FIXTURE_RECONCILIATION_GAP.outcome.record;
    const built = buildReconciliationPublication({
      opId: 'op-recon-gap',
      topic: TOPIC_LIFECYCLE,
      tenantId: FIXTURE_TENANT,
      sender: SENDER,
      reconciliation: record,
      sequence: 4,
      publishedAt: PUB_AT,
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(validateExecutionPublication(built.value, FIXTURE_REGISTRY)).toEqual([]);
    }
  });
});
