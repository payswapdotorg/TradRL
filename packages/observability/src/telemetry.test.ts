/**
 * @tradrl/observability — the TelemetryRecord contract tests.
 *
 * Covers: the union guards (all three kinds, positive and negative),
 * the opacity trip wire over every emitted record (a credential VALUE
 * under a credential-shaped key anywhere — including inside
 * `attributes` — is the typed `credential_value_present` error; a
 * 'cred:' ref is fine), collect-all validation (every simultaneous
 * violation reported), the deepFreeze totality, and the determinism
 * goldens (same inputs → byte-identical canonical JSON, asserted
 * twice through independent constructions).
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalTelemetryContentJson,
  credentialValueViolations,
  deepFreeze,
  isDeeplyFrozen,
  isTelemetryRecord,
  validateTelemetryRecord,
  type MetricTelemetryRecord,
  type TraceSpanTelemetryRecord,
  type LogTelemetryRecord,
  type TelemetryActor,
  type TimestampMs,
  type TenantId,
  type ProjectId,
} from './index';
import type { ObservedSeamRef } from './index';

// ---------------------------------------------------------------------------
// Fixtures (explicit literals — no ambient clock, no randomness)
// ---------------------------------------------------------------------------

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT = 'tenant-telemetry' as TenantId;
const PROJECT = 'project-telemetry' as ProjectId;
const ACTOR: TelemetryActor = { kind: 'service', ref: 'execution-gateway' };
const SEAM: ObservedSeamRef = { kind: 'gateway-audit', auditId: 'xga:0f1e2d3c', tenant: TENANT, project: PROJECT };

/** A valid metric record (overridable per test). */
function metricRecord(overrides: Record<string, unknown> = {}): MetricTelemetryRecord {
  return deepFreeze({
    recordId: 'tel:1a2b3c4d',
    sequence: 1,
    kind: 'metric',
    tenant: TENANT,
    project: PROJECT,
    actor: ACTOR,
    seam: SEAM,
    recordedAt: T0,
    chainHead: '0a1b2c3d',
    name: 'gateway.submissions',
    value: 3,
    unit: 'orders',
    attributes: { stage: 'routing' },
    ...overrides,
  }) as MetricTelemetryRecord;
}

/** A valid trace-span record (overridable per test). */
function spanRecord(overrides: Record<string, unknown> = {}): TraceSpanTelemetryRecord {
  return deepFreeze({
    recordId: 'tel:2b3c4d5e',
    sequence: 2,
    kind: 'trace-span',
    tenant: TENANT,
    project: PROJECT,
    actor: ACTOR,
    seam: { kind: 'kernel-operation', opId: 'kop-0001', type: 'SPAWN', tenant: TENANT },
    recordedAt: T0 + 1_000,
    chainHead: '1b2c3d4e',
    name: 'kernel.applyOperation',
    durationMs: 12,
    status: 'ok',
    attributes: {},
    ...overrides,
  }) as TraceSpanTelemetryRecord;
}

/** A valid log record (overridable per test). */
function logRecord(overrides: Record<string, unknown> = {}): LogTelemetryRecord {
  return deepFreeze({
    recordId: 'tel:3c4d5e6f',
    sequence: 3,
    kind: 'log',
    tenant: TENANT,
    project: PROJECT,
    actor: { kind: 'agent-instance', ref: 'inst-trading-director' },
    seam: { kind: 'agent-envelope', messageId: 'msg-0001', topic: 'org.research.signals', tenant: TENANT },
    recordedAt: T0 + 2_000,
    chainHead: '2c3d4e5f',
    level: 'info',
    message: 'regime researcher published a signal',
    attributes: { envelopeSequence: 1 },
    ...overrides,
  }) as LogTelemetryRecord;
}

// ---------------------------------------------------------------------------
// The guards
// ---------------------------------------------------------------------------

describe('telemetry record guards', () => {
  it('accepts valid records of all three kinds', () => {
    expect(isTelemetryRecord(metricRecord())).toBe(true);
    expect(isTelemetryRecord(spanRecord())).toBe(true);
    expect(isTelemetryRecord(logRecord())).toBe(true);
  });

  it('rejects a record whose id is not tel:-prefixed', () => {
    expect(isTelemetryRecord(metricRecord({ recordId: 'pau:1a2b3c4d' }))).toBe(false);
    expect(isTelemetryRecord(metricRecord({ recordId: 'xga:1a2b3c4d' }))).toBe(false);
  });

  it('rejects a record whose sequence is not a positive safe integer', () => {
    expect(isTelemetryRecord(metricRecord({ sequence: 0 }))).toBe(false);
    expect(isTelemetryRecord(metricRecord({ sequence: 1.5 }))).toBe(false);
    expect(isTelemetryRecord(metricRecord({ sequence: -1 }))).toBe(false);
  });

  it('rejects an unknown kind (the vocabulary is closed)', () => {
    expect(isTelemetryRecord(metricRecord({ kind: 'histogram' }))).toBe(false);
  });

  it('rejects a missing or empty tenant/project scope (L12/L15)', () => {
    expect(isTelemetryRecord(metricRecord({ tenant: '' }))).toBe(false);
    expect(isTelemetryRecord(metricRecord({ project: '' }))).toBe(false);
    const { tenant, ...withoutTenant } = metricRecord();
    void tenant;
    expect(isTelemetryRecord(withoutTenant)).toBe(false);
  });

  it('rejects a malformed actor (closed kind vocabulary, non-empty ref)', () => {
    expect(isTelemetryRecord(metricRecord({ actor: { kind: 'robot', ref: 'x' } }))).toBe(false);
    expect(isTelemetryRecord(metricRecord({ actor: { kind: 'service', ref: '' } }))).toBe(false);
  });

  it('rejects a malformed observed-seam ref (unknown seam kind, bad xga: prefix, bad sequence)', () => {
    expect(isTelemetryRecord(metricRecord({ seam: { kind: 'quantum-envelope', messageId: 'm' } }))).toBe(false);
    expect(isTelemetryRecord(metricRecord({ seam: { kind: 'gateway-audit', auditId: 'tel:1a2b3c4d', tenant: TENANT, project: PROJECT } }))).toBe(false);
    expect(isTelemetryRecord(metricRecord({ seam: { kind: 'control-plane-audit', sequence: 0, tenant: TENANT, project: PROJECT } }))).toBe(false);
  });

  it('rejects a non-instant recordedAt (L4 — the explicit injected instant)', () => {
    expect(isTelemetryRecord(metricRecord({ recordedAt: T0 + 0.5 }))).toBe(false);
    expect(isTelemetryRecord(metricRecord({ recordedAt: -1 }))).toBe(false);
  });

  it('rejects a malformed chain head (lowercase 8-hex)', () => {
    expect(isTelemetryRecord(metricRecord({ chainHead: 'NOTHEX!' }))).toBe(false);
    expect(isTelemetryRecord(metricRecord({ chainHead: '0a1b2c3' }))).toBe(false);
  });

  it('rejects variant-field violations per kind (metric value, span duration/status, log level/message)', () => {
    expect(isTelemetryRecord(metricRecord({ value: Number.NaN }))).toBe(false);
    expect(isTelemetryRecord(metricRecord({ value: Number.POSITIVE_INFINITY }))).toBe(false);
    expect(isTelemetryRecord(metricRecord({ unit: '' }))).toBe(false);
    expect(isTelemetryRecord(metricRecord({ name: '' }))).toBe(false);
    expect(isTelemetryRecord(spanRecord({ durationMs: -1 }))).toBe(false);
    expect(isTelemetryRecord(spanRecord({ durationMs: 1.5 }))).toBe(false);
    expect(isTelemetryRecord(spanRecord({ status: 'pending' }))).toBe(false);
    expect(isTelemetryRecord(logRecord({ level: 'fatal' }))).toBe(false);
    expect(isTelemetryRecord(logRecord({ message: '' }))).toBe(false);
  });

  it('rejects non-JSON attributes (NaN, Infinity, undefined functions)', () => {
    expect(isTelemetryRecord(metricRecord({ attributes: { bad: Number.NaN } }))).toBe(false);
    expect(isTelemetryRecord(metricRecord({ attributes: { bad: Number.POSITIVE_INFINITY } }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The opacity trip wire (over EVERY emitted record)
// ---------------------------------------------------------------------------

describe('the credential-opacity trip wire over telemetry records', () => {
  it('flags a credential VALUE under a credential-shaped key in attributes (typed credential_value_present)', () => {
    const contaminated = metricRecord({ attributes: { apiKey: 'AKIA-SECRET' } });
    const validation = validateTelemetryRecord(contaminated);
    expect(validation.ok).toBe(false);
    expect(validation.errors).toHaveLength(1);
    expect(validation.errors[0]?.code).toBe('credential_value_present');
    expect(validation.errors[0]?.path).toBe('telemetryRecord.attributes.apiKey');
    expect(isTelemetryRecord(contaminated)).toBe(false);
  });

  it('flags credential values case- and separator-insensitively (API-KEY, api_key, Passphrase)', () => {
    expect(credentialValueViolations({ 'API-KEY': 'x' })).toEqual(['API-KEY']);
    expect(credentialValueViolations({ api_key: 'x' })).toEqual(['api_key']);
    expect(credentialValueViolations({ nested: { passphrase: 'x' } })).toEqual(['nested.passphrase']);
    expect(credentialValueViolations({ list: [{ seedPhrase: 'x' }] })).toEqual(['list[0].seedPhrase']);
  });

  it('accepts a cred:-prefixed REFERENCE (a ref is fine; a value is not)', () => {
    const clean = metricRecord({ attributes: { credentialRef: 'cred:broker-main@1', note: 'routed via broker channel' } });
    expect(credentialValueViolations(clean)).toEqual([]);
    expect(isTelemetryRecord(clean)).toBe(true);
  });

  it('flags a bare "credential" key anywhere in the record', () => {
    const contaminated = logRecord({ attributes: { payload: { credential: 'super-secret-material' } } });
    expect(isTelemetryRecord(contaminated)).toBe(false);
    expect(validateTelemetryRecord(contaminated).errors[0]?.code).toBe('credential_value_present');
  });
});

// ---------------------------------------------------------------------------
// Collect-all validation
// ---------------------------------------------------------------------------

describe('collect-all validation', () => {
  it('collects EVERY simultaneous violation (not first-fail)', () => {
    const broken = {
      recordId: 'pau:oops',
      sequence: 0,
      kind: 'histogram',
      tenant: '',
      project: '',
      actor: { kind: 'robot', ref: '' },
      seam: { kind: 'wormhole', x: 1 },
      recordedAt: -5,
      chainHead: 'nope',
    };
    const validation = validateTelemetryRecord(broken);
    expect(validation.ok).toBe(false);
    const codes = validation.errors.map((error) => `${error.code}@${error.path}`);
    expect(codes).toContain('invalid_field@telemetryRecord.recordId');
    expect(codes).toContain('invalid_field@telemetryRecord.sequence');
    expect(codes).toContain('invalid_field@telemetryRecord.kind');
    expect(codes).toContain('invalid_field@telemetryRecord.tenant');
    expect(codes).toContain('invalid_field@telemetryRecord.project');
    expect(codes).toContain('invalid_field@telemetryRecord.actor');
    expect(codes).toContain('invalid_field@telemetryRecord.seam');
    expect(codes).toContain('invalid_field@telemetryRecord.recordedAt');
    expect(codes).toContain('invalid_field@telemetryRecord.chainHead');
    expect(validation.errors.length).toBeGreaterThanOrEqual(9);
  });

  it('reports missing fields as missing_field (distinct from invalid_field)', () => {
    const validation = validateTelemetryRecord({ kind: 'metric' });
    expect(validation.ok).toBe(false);
    const missing = validation.errors.filter((error) => error.code === 'missing_field').map((error) => error.path);
    for (const path of [
      'telemetryRecord.recordId',
      'telemetryRecord.sequence',
      'telemetryRecord.tenant',
      'telemetryRecord.project',
      'telemetryRecord.actor',
      'telemetryRecord.seam',
      'telemetryRecord.recordedAt',
      'telemetryRecord.chainHead',
      'telemetryRecord.name',
      'telemetryRecord.value',
      'telemetryRecord.unit',
      'telemetryRecord.attributes',
    ]) {
      expect(missing).toContain(path);
    }
  });

  it('rejects a non-object root with a single invalid_type error', () => {
    const validation = validateTelemetryRecord(42);
    expect(validation.ok).toBe(false);
    expect(validation.errors).toHaveLength(1);
    expect(validation.errors[0]?.code).toBe('invalid_type');
  });
});

// ---------------------------------------------------------------------------
// deepFreeze totality
// ---------------------------------------------------------------------------

describe('deepFreeze totality', () => {
  it('freezes every reachable object and array of a record', () => {
    for (const record of [metricRecord(), spanRecord(), logRecord()]) {
      expect(isDeeplyFrozen(record)).toBe(true);
    }
  });

  it('makes mutation attempts throw (the runtime half of the append-only discipline)', () => {
    const record = metricRecord();
    expect(() => {
      (record as unknown as Record<string, unknown>).value = 99;
    }).toThrow();
    expect(() => {
      (record.attributes as unknown as Record<string, unknown>).stage = 'tampered';
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Determinism goldens (asserted twice — two independent constructions)
// ---------------------------------------------------------------------------

describe('determinism goldens', () => {
  it('serializes the same metric content byte-identically (construction 1 vs construction 2)', () => {
    const first = canonicalTelemetryContentJson({
      sequence: 1,
      kind: 'metric',
      tenant: TENANT,
      project: PROJECT,
      actor: { kind: 'service', ref: 'execution-gateway' },
      seam: SEAM,
      recordedAt: T0,
      name: 'gateway.submissions',
      value: 3,
      unit: 'orders',
      attributes: { stage: 'routing', venue: 'BINANCE' },
    });
    const second = canonicalTelemetryContentJson({
      attributes: { venue: 'BINANCE', stage: 'routing' }, // key order deliberately different
      unit: 'orders',
      value: 3,
      name: 'gateway.submissions',
      recordedAt: T0,
      seam: SEAM,
      actor: { ref: 'execution-gateway', kind: 'service' },
      project: PROJECT,
      tenant: TENANT,
      kind: 'metric',
      sequence: 1,
    });
    expect(first).toBe(second);
    // The golden literal (the byte-determinism anchor — key-sorted, total form).
    expect(first).toBe(
      '{"actor":{"kind":"service","ref":"execution-gateway"},"attributes":{"stage":"routing","venue":"BINANCE"},"kind":"metric","name":"gateway.submissions","project":"project-telemetry","recordedAt":1717459200000,"seam":{"auditId":"xga:0f1e2d3c","kind":"gateway-audit","project":"project-telemetry","tenant":"tenant-telemetry"},"sequence":1,"tenant":"tenant-telemetry","unit":"orders","value":3}',
    );
  });

  it('serializes the same span and log contents byte-identically (construction 1 vs construction 2)', () => {
    const spanA = canonicalTelemetryContentJson({
      sequence: 2,
      kind: 'trace-span',
      tenant: TENANT,
      project: PROJECT,
      actor: ACTOR,
      seam: { kind: 'kernel-operation', opId: 'kop-0001', type: 'SPAWN', tenant: TENANT },
      recordedAt: T0 + 1_000,
      name: 'kernel.applyOperation',
      durationMs: 12,
      status: 'ok',
      attributes: {},
    });
    const spanB = canonicalTelemetryContentJson({
      attributes: {},
      status: 'ok',
      durationMs: 12,
      name: 'kernel.applyOperation',
      recordedAt: T0 + 1_000,
      seam: { tenant: TENANT, type: 'SPAWN', opId: 'kop-0001', kind: 'kernel-operation' },
      actor: ACTOR,
      project: PROJECT,
      tenant: TENANT,
      kind: 'trace-span',
      sequence: 2,
    });
    expect(spanA).toBe(spanB);
    expect(spanA).toBe(
      '{"actor":{"kind":"service","ref":"execution-gateway"},"attributes":{},"durationMs":12,"kind":"trace-span","name":"kernel.applyOperation","project":"project-telemetry","recordedAt":1717459201000,"seam":{"kind":"kernel-operation","opId":"kop-0001","tenant":"tenant-telemetry","type":"SPAWN"},"sequence":2,"status":"ok","tenant":"tenant-telemetry"}',
    );

    const logA = canonicalTelemetryContentJson({
      sequence: 3,
      kind: 'log',
      tenant: TENANT,
      project: PROJECT,
      actor: { kind: 'agent-instance', ref: 'inst-trading-director' },
      seam: { kind: 'agent-envelope', messageId: 'msg-0001', topic: 'org.research.signals', tenant: TENANT },
      recordedAt: T0 + 2_000,
      level: 'warn',
      message: 'escalation raised: limit utilization at 92%',
      attributes: { chainDepth: 3 },
    });
    const logB = canonicalTelemetryContentJson({
      attributes: { chainDepth: 3 },
      message: 'escalation raised: limit utilization at 92%',
      level: 'warn',
      recordedAt: T0 + 2_000,
      seam: { tenant: TENANT, topic: 'org.research.signals', messageId: 'msg-0001', kind: 'agent-envelope' },
      actor: { ref: 'inst-trading-director', kind: 'agent-instance' },
      project: PROJECT,
      tenant: TENANT,
      kind: 'log',
      sequence: 3,
    });
    expect(logA).toBe(logB);
  });
});
