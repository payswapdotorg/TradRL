// @tradrl/body-cross-market-researcher — the publication tests.
//
// Behavioral: the envelope mirror's derived identity (the kernel's exact
// formula), the payload binding law, the port discipline (outputs leave
// ONLY through the port; the recording port is honest). Negative paths:
// reserved kernel topics, free-text/unbound payloads, invalid reports,
// tenant mismatches.

import { describe, expect, it } from 'vitest';
import {
  KERNEL_TOPICS_MIRROR,
  buildCrossMarketPublication,
  createCrossMarketRecordingPort,
  crossMarketReportRefOf,
  isCrossMarketPublication,
  isCrossMarketPublicationPort,
  isKernelTopicMirror,
  isMessageEnvelopeMirror,
  serializeCrossMarketPublication,
  validateCrossMarketPublication,
} from './publication';
import {
  FIXTURE_AS_OF,
  FIXTURE_REGISTRY,
  FIXTURE_REPORT,
  FIXTURE_SENDER,
  FIXTURE_TENANT,
  FIXTURE_TOPIC,
} from './fixtures';
import { isDeeplyFrozen } from './primitives';

describe('the envelope mirror (agent-os)', () => {
  it('the kernel topic reservation is closed and matches the seven reserved names', () => {
    expect(KERNEL_TOPICS_MIRROR.length).toBe(7);
    expect(isKernelTopicMirror('kernel.approve')).toBe(true);
    expect(isKernelTopicMirror('research.crossmarket')).toBe(false);
  });

  it('builds a bound publication with the kernel-derived envelope id', () => {
    const built = buildCrossMarketPublication({
      opId: 'op-pub-0001',
      topic: FIXTURE_TOPIC as never,
      tenantId: FIXTURE_TENANT,
      sender: FIXTURE_SENDER as never,
      report: FIXTURE_REPORT,
      sequence: 1,
      publishedAt: FIXTURE_AS_OF,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.envelope.id).toBe(`msg:op-pub-0001:${FIXTURE_SENDER}:1`);
    expect(built.value.envelope.payload).toBe(`report:${FIXTURE_REPORT.reportId}`);
    expect(built.value.envelope.topic).toBe(FIXTURE_TOPIC);
    expect(isMessageEnvelopeMirror(built.value.envelope)).toBe(true);
    expect(isCrossMarketPublication(built.value)).toBe(true);
    expect(isDeeplyFrozen(built.value)).toBe(true);
    expect(validateCrossMarketPublication(built.value, FIXTURE_REGISTRY)).toEqual([]);
  });

  it('crossMarketReportRefOf binds the derived id', () => {
    expect(crossMarketReportRefOf(FIXTURE_REPORT)).toBe(`report:${FIXTURE_REPORT.reportId}`);
  });

  it('causality defaults to the causing operation id', () => {
    const built = buildCrossMarketPublication({
      opId: 'op-pub-0002',
      topic: FIXTURE_TOPIC as never,
      tenantId: FIXTURE_TENANT,
      sender: FIXTURE_SENDER as never,
      report: FIXTURE_REPORT,
      sequence: 2,
      publishedAt: FIXTURE_AS_OF,
    });
    if (!built.ok) throw new Error('must build');
    expect(built.value.envelope.causalityId).toBe('op-pub-0002');
  });
});

describe('THE NEGATIVE PATHS (the publication discipline)', () => {
  it('a reserved kernel topic is refused (reserved_publication_topic)', () => {
    const built = buildCrossMarketPublication({
      opId: 'op-x',
      topic: 'kernel.approve' as never,
      tenantId: FIXTURE_TENANT,
      sender: FIXTURE_SENDER as never,
      report: FIXTURE_REPORT,
      sequence: 1,
      publishedAt: FIXTURE_AS_OF,
    });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.errors[0]?.code).toBe('reserved_publication_topic');
    }

    const doctored = {
      envelope: { topic: 'kernel.escalate' as never, tenantId: FIXTURE_TENANT, sender: FIXTURE_SENDER, payload: crossMarketReportRefOf(FIXTURE_REPORT), sequence: 1, causalityId: null, publishedAt: FIXTURE_AS_OF, id: 'msg:x:y:1' },
      report: FIXTURE_REPORT,
    };
    expect(validateCrossMarketPublication(doctored, FIXTURE_REGISTRY).map((e) => e.code)).toContain(
      'reserved_publication_topic',
    );
  });

  it('a free-text payload is refused (unstructured_publication)', () => {
    const doctored = {
      envelope: { topic: FIXTURE_TOPIC as never, tenantId: FIXTURE_TENANT, sender: FIXTURE_SENDER, payload: 'BTC-USD-looks-correlated-trust-me', sequence: 1, causalityId: null, publishedAt: FIXTURE_AS_OF, id: 'msg:x:y:1' },
      report: FIXTURE_REPORT,
    };
    const errors = validateCrossMarketPublication(doctored, FIXTURE_REGISTRY);
    expect(errors.map((e) => e.code)).toContain('unstructured_publication');
  });

  it('a payload not bound to the carried report is refused (unstructured_publication)', () => {
    const built = buildCrossMarketPublication({
      opId: 'op-pub-0003',
      topic: FIXTURE_TOPIC as never,
      tenantId: FIXTURE_TENANT,
      sender: FIXTURE_SENDER as never,
      report: FIXTURE_REPORT,
      sequence: 3,
      publishedAt: FIXTURE_AS_OF,
    });
    if (!built.ok) throw new Error('must build');
    const doctored = {
      ...built.value,
      envelope: { ...built.value.envelope, payload: `report:${'0'.repeat(16)}` },
    };
    expect(validateCrossMarketPublication(doctored, FIXTURE_REGISTRY).map((e) => e.code)).toContain(
      'unstructured_publication',
    );
  });

  it('an invalid report is refused with the report\'s own laws surfaced (unstructured_publication)', () => {
    const built = buildCrossMarketPublication({
      opId: 'op-pub-0004',
      topic: FIXTURE_TOPIC as never,
      tenantId: FIXTURE_TENANT,
      sender: FIXTURE_SENDER as never,
      report: FIXTURE_REPORT,
      sequence: 4,
      publishedAt: FIXTURE_AS_OF,
    });
    if (!built.ok) throw new Error('must build');
    const poisoned = { ...built.value, report: { ...FIXTURE_REPORT, tenantId: '' as never } };
    const errors = validateCrossMarketPublication(poisoned, FIXTURE_REGISTRY);
    expect(errors.map((e) => e.code)).toContain('unstructured_publication');
  });

  it('a tenant mismatch between envelope and report is refused (tenant_missing)', () => {
    const doctored = {
      envelope: { topic: FIXTURE_TOPIC as never, tenantId: 'tenant-other' as never, sender: FIXTURE_SENDER, payload: crossMarketReportRefOf(FIXTURE_REPORT), sequence: 1, causalityId: null, publishedAt: FIXTURE_AS_OF, id: 'msg:x:y:1' },
      report: FIXTURE_REPORT,
    };
    expect(validateCrossMarketPublication(doctored, FIXTURE_REGISTRY).map((e) => e.code)).toContain('tenant_missing');
  });

  it('malformed inputs are refused (collect-all, typed)', () => {
    const built = buildCrossMarketPublication({
      opId: '',
      topic: '' as never,
      tenantId: '' as never,
      sender: '' as never,
      report: FIXTURE_REPORT,
      sequence: 0,
      publishedAt: -1 as never,
    });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.errors.length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('the recording port', () => {
  it('is an honest port that records every accepted publication', () => {
    const port = createCrossMarketRecordingPort();
    expect(isCrossMarketPublicationPort(port)).toBe(true);
    const built = buildCrossMarketPublication({
      opId: 'op-pub-0005',
      topic: FIXTURE_TOPIC as never,
      tenantId: FIXTURE_TENANT,
      sender: FIXTURE_SENDER as never,
      report: FIXTURE_REPORT,
      sequence: 5,
      publishedAt: FIXTURE_AS_OF,
    });
    if (!built.ok) throw new Error('must build');
    const receipt = port.publish(built.value);
    expect(receipt.ok).toBe(true);
    if (receipt.ok) {
      expect(receipt.value.envelopeId).toBe(built.value.envelope.id);
      expect(receipt.value.reportRef).toBe(`report:${FIXTURE_REPORT.reportId}`);
    }
    expect(port.published.length).toBe(1);
    expect(port.published[0]?.report.reportId).toBe(FIXTURE_REPORT.reportId);
  });

  it('serializes byte-deterministically', () => {
    const built = buildCrossMarketPublication({
      opId: 'op-pub-0006',
      topic: FIXTURE_TOPIC as never,
      tenantId: FIXTURE_TENANT,
      sender: FIXTURE_SENDER as never,
      report: FIXTURE_REPORT,
      sequence: 6,
      publishedAt: FIXTURE_AS_OF,
    });
    if (!built.ok) throw new Error('must build');
    expect(serializeCrossMarketPublication(built.value)).toBe(serializeCrossMarketPublication(built.value));
  });
});
