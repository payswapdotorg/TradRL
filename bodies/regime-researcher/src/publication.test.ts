// @tradrl/body-regime-researcher — the publication contracts tests.

import { describe, expect, it } from 'vitest';

import {
  KERNEL_TOPICS_MIRROR,
  buildRegimePublication,
  createRegimeRecordingPort,
  isRegimeMessageEnvelope,
  isRegimePublicationPort,
  regimeReportRefOf,
  serializeRegimePublication,
  validateRegimePublication,
} from './publication';
import { type AgentInstanceId, type TenantId, type TopicName } from './ids';
import type { TimestampMs } from './primitives';
import {
  FIXTURE_AS_OF,
  FIXTURE_REPORT,
  FIXTURE_REGISTRY,
  FIXTURE_SENDER,
  FIXTURE_TENANT,
  FIXTURE_TOPIC,
} from './fixtures';
import { REGIME_METHOD_REGISTRY } from './methods';
import { isDeeplyFrozen } from './primitives';

const codesOf = (errors: readonly { code: string }[]): readonly string[] => errors.map((e) => e.code);

function fixturePublication() {
  const built = buildRegimePublication({
    opId: 'op-regime-0001',
    topic: FIXTURE_TOPIC as TopicName,
    tenantId: FIXTURE_TENANT as TenantId,
    sender: FIXTURE_SENDER as AgentInstanceId,
    report: FIXTURE_REPORT,
    sequence: 1,
    publishedAt: FIXTURE_AS_OF,
  });
  if (!built.ok) throw new Error(`publication must build: ${JSON.stringify(built.errors)}`);
  return built.value;
}

describe('buildRegimePublication', () => {
  it('builds with the kernel-derived envelope id formula (msg:${opId}:${sender}:${sequence})', () => {
    const publication = fixturePublication();
    expect(publication.envelope.id).toBe(`msg:op-regime-0001:${FIXTURE_SENDER}:1`);
    expect(publication.envelope.topic).toBe('research.regime');
    expect(publication.envelope.causalityId).toBe('op-regime-0001');
    expect(isRegimeMessageEnvelope(publication.envelope)).toBe(true);
    expect(isDeeplyFrozen(publication)).toBe(true);
  });

  it('is deterministic: the same input builds byte-identically twice', () => {
    const once = fixturePublication();
    const twice = fixturePublication();
    expect(once).toEqual(twice);
    expect(serializeRegimePublication(once)).toBe(serializeRegimePublication(twice));
  });

  it('rejects a reserved kernel topic (reserved_publication_topic)', () => {
    const built = buildRegimePublication({
      opId: 'op-x',
      topic: 'kernel.approve' as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      report: FIXTURE_REPORT,
      sequence: 1,
      publishedAt: FIXTURE_AS_OF,
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(codesOf(built.errors)).toContain('reserved_publication_topic');
  });

  it('rejects invalid input with typed errors (never throws)', () => {
    for (const bad of [
      { opId: '', topic: 'research.regime' as TopicName, tenantId: 't' as TenantId, sender: 's' as AgentInstanceId, report: FIXTURE_REPORT, sequence: 0, publishedAt: FIXTURE_AS_OF },
      { opId: 'op', topic: 'research.regime' as TopicName, tenantId: '' as TenantId, sender: 's' as AgentInstanceId, report: FIXTURE_REPORT, sequence: 1, publishedAt: FIXTURE_AS_OF },
      { opId: 'op', topic: 'research.regime' as TopicName, tenantId: 't' as TenantId, sender: 's' as AgentInstanceId, report: FIXTURE_REPORT, sequence: 1, publishedAt: -1 as TimestampMs },
    ]) {
      const result = buildRegimePublication(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe('validateRegimePublication (the port-side discipline)', () => {
  it('a bound, valid publication validates cleanly', () => {
    expect(validateRegimePublication(fixturePublication(), FIXTURE_REGISTRY)).toEqual([]);
  });

  it('a free-text payload fails (unstructured_publication)', () => {
    const publication = fixturePublication();
    const free = {
      ...publication,
      envelope: { ...publication.envelope, payload: 'markets-look-bullish-buy-now' },
    };
    const errors = validateRegimePublication(free, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('unstructured_publication');
  });

  it('a payload not bound to the carried report fails (unstructured_publication)', () => {
    const publication = fixturePublication();
    const unbound = {
      ...publication,
      envelope: { ...publication.envelope, payload: `report:${'rr-0000000000000000'}` },
    };
    const errors = validateRegimePublication(unbound, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('unstructured_publication');
  });

  it('an invalid report fails through the publication (the report\'s own laws)', () => {
    const publication = fixturePublication();
    const invalid = {
      ...publication,
      report: { ...publication.report, tenantId: '' },
    };
    const errors = validateRegimePublication(invalid, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('unstructured_publication');
  });

  it('a tenant-mismatched envelope fails (L12)', () => {
    const publication = fixturePublication();
    const mismatched = {
      ...publication,
      envelope: { ...publication.envelope, tenantId: 'tenant-other' as TenantId },
    };
    const errors = validateRegimePublication(mismatched, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('tenant_missing');
  });

  it('the opaque report reference is report:<reportId>', () => {
    expect(regimeReportRefOf(FIXTURE_REPORT)).toBe(`report:${FIXTURE_REPORT.reportId}`);
    expect(fixturePublication().envelope.payload).toBe(`report:${FIXTURE_REPORT.reportId}`);
  });
});

describe('the recording port (the only seam outputs leave through)', () => {
  it('is a structural port and records accepted publications in order', () => {
    const port = createRegimeRecordingPort();
    expect(isRegimePublicationPort(port)).toBe(true);
    const publication = fixturePublication();
    const receipt = port.publish(publication);
    expect(receipt.ok).toBe(true);
    if (receipt.ok) {
      expect(receipt.value.envelopeId).toBe(publication.envelope.id);
      expect(receipt.value.reportRef).toBe(publication.envelope.payload);
    }
    expect(port.published.length).toBe(1);
    expect(port.published[0]!.report.reportId).toBe(FIXTURE_REPORT.reportId);
  });

  it('refuses a malformed publication with a typed error', () => {
    const port = createRegimeRecordingPort();
    const receipt = port.publish({ nonsense: true } as never);
    expect(receipt.ok).toBe(false);
    if (!receipt.ok) expect(codesOf(receipt.errors)).toContain('invalid_type');
  });

  it('the full validated publication passes the registry laws end to end', () => {
    const publication = fixturePublication();
    expect(validateRegimePublication(publication, REGIME_METHOD_REGISTRY)).toEqual([]);
  });
});
