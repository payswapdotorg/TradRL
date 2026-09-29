// @tradrl/body-sentiment-researcher — publication discipline tests.

import { describe, expect, it } from 'vitest';

import {
  buildResearchPublication,
  createRecordingPublicationPort,
  isKernelTopicMirror,
  isMessageEnvelopeMirror,
  isResearchPublicationPort,
  isResearchPublication,
  KERNEL_TOPICS_MIRROR,
  reportRefOf,
  serializeResearchPublication,
  validateResearchPublication,
  type ResearchPublication,
} from './publication';
import { type TimestampMs, isDeeplyFrozen } from './primitives';
import { type AgentInstanceId, type TenantId, type TopicName } from './ids';
import { FIXTURE_AS_OF, FIXTURE_REGISTRY, FIXTURE_REPORT, FIXTURE_SENDER, FIXTURE_TENANT, FIXTURE_TOPIC } from './fixtures';

const ms = (value: number): TimestampMs => value as TimestampMs;

const buildInput = {
  opId: 'op-pub-0001',
  topic: FIXTURE_TOPIC as TopicName,
  tenantId: FIXTURE_TENANT as TenantId,
  sender: FIXTURE_SENDER as AgentInstanceId,
  report: FIXTURE_REPORT,
  sequence: 1,
  publishedAt: FIXTURE_AS_OF,
};

describe('the publication record', () => {
  it('builds with the kernel-derived envelope id formula (msg:${opId}:${sender}:${sequence})', () => {
    const result = buildResearchPublication(buildInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.envelope.id).toBe(`msg:${buildInput.opId}:${FIXTURE_SENDER}:1`);
    expect(result.value.envelope.payload).toBe(`report:${FIXTURE_REPORT.reportId}`);
    expect(result.value.envelope.causalityId).toBe(buildInput.opId);
    expect(result.value.report).toBe(FIXTURE_REPORT);
    expect(isMessageEnvelopeMirror(result.value.envelope)).toBe(true);
    expect(isDeeplyFrozen(result.value)).toBe(true);
    expect(reportRefOf(FIXTURE_REPORT)).toBe(`report:${FIXTURE_REPORT.reportId}`);
  });

  it('is deterministic: the same input builds byte-identically twice', () => {
    const once = buildResearchPublication(buildInput);
    const twice = buildResearchPublication(buildInput);
    if (!once.ok || !twice.ok) throw new Error('unreachable');
    expect(once.value).toEqual(twice.value);
    expect(serializeResearchPublication(once.value)).toBe(serializeResearchPublication(twice.value));
  });

  it('rejects a reserved kernel topic (reserved_publication_topic)', () => {
    const result = buildResearchPublication({ ...buildInput, topic: 'kernel.approve' as TopicName });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors.map((e) => e.code)).toContain('reserved_publication_topic');
  });

  it('rejects invalid input with typed errors (never throws)', () => {
    const result = buildResearchPublication({ ...buildInput, sequence: 0, publishedAt: -1 as TimestampMs });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('the payload discipline (structured records only)', () => {
  it('a bound, valid publication validates cleanly', () => {
    const built = buildResearchPublication(buildInput);
    if (!built.ok) throw new Error('unreachable');
    expect(validateResearchPublication(built.value, FIXTURE_REGISTRY)).toEqual([]);
    expect(isResearchPublication(built.value)).toBe(true);
  });

  it('a free-text payload fails (unstructured_publication)', () => {
    const publication: ResearchPublication = {
      envelope: {
        id: 'msg:x:y:1',
        topic: FIXTURE_TOPIC as TopicName,
        tenantId: FIXTURE_TENANT as TenantId,
        sender: FIXTURE_SENDER as AgentInstanceId,
        payload: 'AAPL-looks-bullish-trust-me',
        sequence: 1,
        causalityId: 'op-1',
        publishedAt: ms(1_717_423_200_000),
      },
      report: FIXTURE_REPORT,
    };
    const codes = validateResearchPublication(publication, FIXTURE_REGISTRY).map((e) => e.code);
    expect(codes).toContain('unstructured_publication');
  });

  it('a payload not bound to the carried report fails (unstructured_publication)', () => {
    const built = buildResearchPublication(buildInput);
    if (!built.ok) throw new Error('unreachable');
    const unbound: ResearchPublication = {
      ...built.value,
      envelope: { ...built.value.envelope, payload: 'report:rr-0000000000000000' },
    };
    expect(validateResearchPublication(unbound, FIXTURE_REGISTRY).map((e) => e.code)).toContain(
      'unstructured_publication',
    );
  });

  it('an invalid report fails through the publication (the report\'s own laws)', () => {
    const built = buildResearchPublication(buildInput);
    if (!built.ok) throw new Error('unreachable');
    const brokenReport = JSON.parse(JSON.stringify(built.value.report));
    (brokenReport as { tenantId: string }).tenantId = '';
    const broken: ResearchPublication = { ...built.value, report: brokenReport };
    const codes = validateResearchPublication(broken, FIXTURE_REGISTRY).map((e) => e.code);
    expect(codes).toContain('unstructured_publication');
  });

  it('a tenant-mismatched envelope fails (L12)', () => {
    const built = buildResearchPublication(buildInput);
    if (!built.ok) throw new Error('unreachable');
    const mismatched: ResearchPublication = {
      ...built.value,
      envelope: { ...built.value.envelope, tenantId: 'tenant-other' as TenantId },
    };
    expect(validateResearchPublication(mismatched, FIXTURE_REGISTRY).map((e) => e.code)).toContain(
      'tenant_missing',
    );
  });
});

describe('the kernel topic reservation (agent-os mirror)', () => {
  it('mirrors the seven reserved topics exactly', () => {
    expect(KERNEL_TOPICS_MIRROR).toEqual([
      'kernel.request',
      'kernel.delegate',
      'kernel.challenge',
      'kernel.propose',
      'kernel.approve',
      'kernel.escalate',
      'kernel.cascade-escalate',
    ]);
    for (const topic of KERNEL_TOPICS_MIRROR) expect(isKernelTopicMirror(topic)).toBe(true);
    expect(isKernelTopicMirror('research.sentiment')).toBe(false);
  });
});

describe('the publication port', () => {
  it('is a structural port and records accepted publications in order', () => {
    const port = createRecordingPublicationPort();
    expect(isResearchPublicationPort(port)).toBe(true);
    const built = buildResearchPublication(buildInput);
    if (!built.ok) throw new Error('unreachable');
    const receipt = port.publish(built.value);
    expect(receipt.ok).toBe(true);
    if (receipt.ok) {
      expect(receipt.value.reportRef).toBe(`report:${FIXTURE_REPORT.reportId}`);
      expect(receipt.value.envelopeId).toBe(built.value.envelope.id);
    }
    expect(port.published.length).toBe(1);
    expect(port.published[0]!.report).toBe(FIXTURE_REPORT);
    expect(port.published[0]!.envelope.payload).toBe(`report:${FIXTURE_REPORT.reportId}`);
  });

  it('refuses a malformed publication with a typed error', () => {
    const port = createRecordingPublicationPort();
    const result = port.publish({ nonsense: true } as unknown as ResearchPublication);
    expect(result.ok).toBe(false);
    expect(port.published.length).toBe(0);
  });
});
