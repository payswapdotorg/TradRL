/**
 * @tradrl/observability_service — the collector tests.
 *
 * Covers: the injected-instant law (each recording consumes EXACTLY
 * ONE instant; malformed observations never burn the clock), the
 * scripted-instants determinism, the injected consumer sinks
 * (append-order dispatch, never for rejected records), the observe
 * path over mirror-valid seam records (identity-referencing, never
 * payload-copying — proven by a byte scan), the opacity trip wire
 * over every emitted record, and the collector's own scope laws.
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  type ProjectId,
  type TelemetryRecord,
  type TimestampMs,
  type TenantId,
} from '../../../packages/observability/src/index';
import { createObservabilityCollector, type ObservabilityCollector } from './collector';
import { scriptedInstants, type TelemetrySink } from './ports';
import { verifyTelemetryLog } from './log';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT = 'tenant-collector' as TenantId;
const PROJECT = 'project-collector' as ProjectId;

/** Unwrap a result or fail loudly. */
function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`must succeed: ${JSON.stringify(result.errors)}`);
}

/** A recording sink (captures every ingested record). */
function recordingSink(): { sink: TelemetrySink; records: TelemetryRecord[] } {
  const records: TelemetryRecord[] = [];
  return { sink: { ingest: (record) => records.push(record) }, records };
}

/** A fresh collector over five scripted instants. */
function freshCollector(sinks: readonly TelemetrySink[] = []) {
  const instants = scriptedInstants([T0, T0 + 1_000, T0 + 2_000, T0 + 3_000, T0 + 4_000]);
  const collector = unwrap(createObservabilityCollector({ tenant: TENANT, project: PROJECT, instants, sinks }));
  return { instants, collector };
}

const GATEWAY_SEAM = { kind: 'gateway-audit', auditId: 'xga:0f1e2d3c', tenant: TENANT, project: PROJECT } as const;
const SERVICE_ACTOR = { kind: 'service', ref: 'execution-gateway' } as const;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('createObservabilityCollector', () => {
  it('rejects a missing scope and a missing instant source', () => {
    const instants = scriptedInstants([T0]);
    expect(createObservabilityCollector({ tenant: '' as TenantId, project: PROJECT, instants }).ok).toBe(false);
    expect(createObservabilityCollector({ tenant: TENANT, project: '' as ProjectId, instants }).ok).toBe(false);
    expect(createObservabilityCollector({ tenant: TENANT, project: PROJECT, instants: {} as never }).ok).toBe(false);
    expect(createObservabilityCollector({ tenant: TENANT, project: PROJECT, instants, sinks: [{ nope: true } as never] }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The injected-instant law
// ---------------------------------------------------------------------------

describe('the injected-instant law (no ambient clock)', () => {
  it('each recording consumes EXACTLY ONE instant (remaining drops by one per record)', () => {
    const { instants, collector } = freshCollector();
    expect(instants.remaining()).toBe(5);
    unwrap(collector.metric({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: 'gateway.submissions', value: 1 }));
    expect(instants.remaining()).toBe(4);
    unwrap(collector.traceSpan({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: 'kernel.applyOperation', durationMs: 3, status: 'ok' }));
    expect(instants.remaining()).toBe(3);
    unwrap(collector.logEntry({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, level: 'info', message: 'routed' }));
    expect(instants.remaining()).toBe(2);
  });

  it('records carry the scripted instants verbatim (recordedAt = the consumed instant)', () => {
    const { collector } = freshCollector();
    const first = unwrap(collector.metric({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: 'm', value: 1 }));
    const second = unwrap(collector.metric({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: 'm', value: 2 }));
    expect(first.recordedAt).toBe(T0);
    expect(second.recordedAt).toBe(T0 + 1_000);
  });

  it('a malformed observation NEVER burns the clock (validation before consumption)', () => {
    const { instants, collector } = freshCollector();
    const rejected = collector.metric({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: '', value: 1 });
    expect(rejected.ok).toBe(false);
    expect(instants.remaining()).toBe(5);
    const rejectedValue = collector.metric({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: 'm', value: Number.NaN });
    expect(rejectedValue.ok).toBe(false);
    expect(instants.remaining()).toBe(5);
  });

  it('normalizes optionality deterministically (unit -> null, attributes -> {})', () => {
    const { collector } = freshCollector();
    const record = unwrap(collector.metric({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: 'unitless', value: 5 }));
    expect(record.kind).toBe('metric');
    if (record.kind === 'metric') {
      expect(record.unit).toBe(null);
      expect(record.attributes).toEqual({});
    }
  });
});

// ---------------------------------------------------------------------------
// The injected sinks (consumer ports)
// ---------------------------------------------------------------------------

describe('the injected consumer sinks', () => {
  it('sinks receive every appended record in append order', () => {
    const a = recordingSink();
    const b = recordingSink();
    const { collector } = freshCollector([a.sink, b.sink]);
    const r1 = unwrap(collector.metric({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: 'm', value: 1 }));
    const r2 = unwrap(collector.logEntry({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, level: 'info', message: 'hello' }));
    expect(a.records.map((record) => record.recordId)).toEqual([r1.recordId, r2.recordId]);
    expect(b.records.map((record) => record.recordId)).toEqual([r1.recordId, r2.recordId]);
  });

  it('sinks never receive a rejected record', () => {
    const a = recordingSink();
    const { collector } = freshCollector([a.sink]);
    expect(collector.metric({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: '', value: 1 }).ok).toBe(false);
    expect(a.records).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The growing log
// ---------------------------------------------------------------------------

describe('the collector\u2019s growing log', () => {
  it('appends every record into one chain-verified log', () => {
    const { collector } = freshCollector();
    unwrap(collector.metric({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: 'm', value: 1 }));
    unwrap(collector.traceSpan({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: 's', durationMs: 1, status: 'ok' }));
    unwrap(collector.logEntry({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, level: 'warn', message: 'careful' }));
    const log = collector.currentLog();
    expect(log.records).toHaveLength(3);
    expect(log.tenant).toBe(TENANT);
    expect(verifyTelemetryLog(log).ok).toBe(true);
  });

  it('is deterministic: two collectors over the same script build byte-identical logs', () => {
    const build = (): string => {
      const instants = scriptedInstants([T0, T0 + 1_000, T0 + 2_000]);
      const collector = unwrap(createObservabilityCollector({ tenant: TENANT, project: PROJECT, instants }));
      unwrap(collector.metric({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: 'gateway.submissions', value: 3, unit: 'orders', attributes: { stage: 'routing' } }));
      unwrap(collector.traceSpan({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: 'gate', durationMs: 9, status: 'ok' }));
      unwrap(collector.logEntry({ actor: { kind: 'operator', ref: 'ops-oncall' }, seam: GATEWAY_SEAM, level: 'info', message: 'rotation complete' }));
      const log = collector.currentLog();
      return canonicalJson({
        records: log.records.map((record) => ({ recordId: record.recordId, chainHead: record.chainHead, recordedAt: record.recordedAt, sequence: record.sequence })),
      });
    };
    const first = build();
    const second = build();
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// The opacity trip wire over every emitted record
// ---------------------------------------------------------------------------

describe('the opacity trip wire over collector emissions', () => {
  it('rejects a credential VALUE under a credential-shaped key in attributes (typed, no instant burned)', () => {
    const { instants, collector } = freshCollector();
    const contaminated = collector.metric({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: 'm', value: 1, attributes: { apiKey: 'AKIA-SECRET' } });
    expect(contaminated.ok).toBe(false);
    if (!contaminated.ok) {
      expect(contaminated.errors[0]?.code).toBe('credential_value_present');
      expect(contaminated.errors[0]?.path).toBe('attributes.apiKey');
    }
    expect(instants.remaining()).toBe(5); // never burned the clock
  });

  it('accepts a cred: reference (a ref is fine; a value is not)', () => {
    const { collector } = freshCollector();
    const clean = collector.metric({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: 'm', value: 1, attributes: { credentialRef: 'cred:broker-main@1' } });
    expect(clean.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The observe path (records over the platform's existing seams)
// ---------------------------------------------------------------------------

describe('the observe path (mirror-guarded seam observation)', () => {
  /** A mirror-valid agent-os message envelope. */
  function envelopeRecord() {
    return {
      id: 'msg-observe-0001',
      topic: 'org.research.signals',
      tenantId: 'tenant-collector',
      sender: 'inst-regime-researcher',
      payload: 'SENSITIVE-PAYLOAD-CONTENT-never-to-be-copied',
      sequence: 1,
      causalityId: 'kop-observe-0001',
      publishedAt: T0,
    };
  }

  it('observes a mirror-valid envelope and derives actor + seam ref from it', () => {
    const { collector } = freshCollector();
    const record = unwrap(collector.observe(envelopeRecord(), { message: 'signal envelope observed on the fabric' }));
    expect(record.kind).toBe('log');
    if (record.kind === 'log') {
      expect(record.level).toBe('info'); // the default level
      expect(record.message).toBe('signal envelope observed on the fabric');
    }
    expect(record.actor).toEqual({ kind: 'agent-instance', ref: 'inst-regime-researcher' });
    expect(record.seam).toEqual({ kind: 'agent-envelope', messageId: 'msg-observe-0001', topic: 'org.research.signals', tenant: 'tenant-collector' });
  });

  it('references the seam BY IDENTITY, never by payload (the byte scan)', () => {
    const { collector } = freshCollector();
    const record = unwrap(collector.observe(envelopeRecord(), { message: 'observed' }));
    const serialized = JSON.stringify(record);
    expect(serialized).toContain('msg-observe-0001'); // the identity IS referenced
    expect(serialized).not.toContain('SENSITIVE-PAYLOAD-CONTENT'); // the payload is NOT copied
    expect(serialized).not.toContain('kop-observe-0001'); // even the causality id stays out
  });

  it('observes a mirror-valid T040-shaped record through the gateway-audit path', () => {
    const { collector } = freshCollector();
    const gatewayRecord = {
      auditId: 'xga:9e8f7a6b',
      sequence: 1,
      who: { bodyVersion: { specId: 'spec-director', version: 1 }, intentRef: 'si:1', decisionId: null, decisionKind: null, clientOrderId: 'cl-1' },
      substrate: 'substrate:glm',
      policy: { policyId: 'xpol:1', version: 1 },
      visibleState: { venue: 'BINANCE', instrument: 'BTC-USDT', instrumentClass: 'crypto', referencePrice: '42000.00', rateWindowOrderCount: 0, riskExposureRef: null },
      riskChecks: { evaluationId: null, riskPolicy: { policyId: 'rpol:1', version: 1 }, within: 0, breaching: 0, blocked: 0 },
      order: null,
      execution: null,
      outcome: 'refused',
      refusal: { stage: 'kill-switch', code: 'thrown', detail: null },
      lineage: { intentRef: 'si:1', strategy: { specId: 'spec-director', version: 1 }, goal: { goalId: 'goal-1', version: 1 }, policy: { policyId: 'xpol:1', version: 1 }, venues: ['BINANCE'], seed: 'seed', tenant: TENANT, project: PROJECT },
      tenant: TENANT,
      project: PROJECT,
      asOf: T0,
      chainHead: '12345678',
    };
    const record = unwrap(collector.observe(gatewayRecord, { message: 'refused submission observed', level: 'warn' }));
    expect(record.seam).toEqual({ kind: 'gateway-audit', auditId: 'xga:9e8f7a6b', tenant: TENANT, project: PROJECT });
    expect(record.actor).toEqual({ kind: 'principal', ref: 'spec-director@1' });
    // The T040 payload is never copied — only the opaque identity ref.
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('42000.00');
    expect(serialized).not.toContain('kill-switch');
  });

  it('rejects a non-seam record with the typed invalid_type error', () => {
    const { collector } = freshCollector();
    const rejected = collector.observe({ random: 'record' }, { message: 'nope' });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors[0]?.code).toBe('invalid_type');
    expect(collector.observe(envelopeRecord(), { message: '' }).ok).toBe(false); // invalid options rejected first
  });

  it('observes mirror-valid records of the REMAINING seam kinds and derives their identity refs (kernel-operation, control-plane-audit, event-store)', () => {
    const { collector } = freshCollector();
    // A kernel OBSERVE operation of THIS scope.
    const operation = {
      opId: 'kop-observe-0002',
      type: 'OBSERVE',
      timestamp: T0,
      actor: 'inst-trading-director',
      tenantId: 'tenant-collector',
      queryRef: 'q:signals-latest',
    };
    const opRecord = unwrap(collector.observe(operation, { message: 'kernel observation observed' }));
    expect(opRecord.seam).toEqual({ kind: 'kernel-operation', opId: 'kop-observe-0002', type: 'OBSERVE', tenant: 'tenant-collector' });
    expect(opRecord.actor).toEqual({ kind: 'agent-instance', ref: 'inst-trading-director' });

    // A control-plane journal entry of THIS scope.
    const entry = {
      sequence: 1,
      at: T0,
      tenantId: 'tenant-collector',
      projectId: 'project-collector',
      lineage: { projectId: 'project-collector', goal: { goalId: 'goal-1', version: 1 }, constraintSet: { id: 'cs-1', version: 1 } },
      operation: { kind: 'project.created', draft: { title: 'the project draft' } },
    };
    const entryRecord = unwrap(collector.observe(entry, { message: 'project journal entry observed' }));
    expect(entryRecord.seam).toEqual({ kind: 'control-plane-audit', sequence: 1, tenant: 'tenant-collector', project: 'project-collector' });
    expect(entryRecord.actor).toEqual({ kind: 'service', ref: 'control-plane' });

    // An event-store event (the venue-scoped seam — no scope fields, so no scope check applies).
    const event = {
      event_id: 'evt-observe-0001',
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      event_type: 'trade',
      event_time: T0,
      source_time: null,
      available_time: T0,
      ingestion_time: T0,
      sequence: 1,
      provider: 'binance',
      provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null },
      payload: { price: '42000.00', size: '0.010' },
    };
    const eventRecord = unwrap(collector.observe(event, { message: 'trade event observed' }));
    expect(eventRecord.seam).toEqual({ kind: 'event-store', eventId: 'evt-observe-0001', venue: 'BINANCE' });
    expect(eventRecord.actor).toEqual({ kind: 'service', ref: 'event-store' });
  });
});

// ---------------------------------------------------------------------------
// The seam-scope default-deny at the EMISSION GATE (L12 — the fourth
// checkpoint, now enforced BEFORE the instant is consumed)
// ---------------------------------------------------------------------------

describe('the seam-scope default-deny at the emission gate (L12)', () => {
  /** Assert one rejection shape: typed invalid_field, cross-scope message, path seam. */
  function assertCrossScopeRejection(result: { ok: true } | { ok: false; errors: readonly { readonly code?: string; readonly path?: string; readonly message?: string }[] }) {
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('invalid_field');
      expect(result.errors[0]?.path).toBe('seam');
      expect(result.errors[0]?.message).toContain('cross-scope observation is inexpressible (L12)');
    }
  }

  it('rejects a metric observation over a CROSS-TENANT kernel-operation seam — and NEVER burns the instant', () => {
    const { instants, collector } = freshCollector();
    const foreignSeam = { kind: 'kernel-operation', opId: 'kop-foreign', type: 'SPAWN', tenant: 'tenant-OTHER' } as const;
    const rejected = collector.metric({ actor: SERVICE_ACTOR, seam: foreignSeam, name: 'm', value: 1 });
    assertCrossScopeRejection(rejected);
    expect(instants.remaining()).toBe(5); // the clock was never consumed
  });

  it('rejects a trace-span observation over a CROSS-SCOPE gateway-audit seam (tenant AND project mismatch) — never burns the instant', () => {
    const { instants, collector } = freshCollector();
    const crossTenant = { kind: 'gateway-audit', auditId: 'xga:0f1e2d3c', tenant: 'tenant-OTHER', project: PROJECT } as const;
    assertCrossScopeRejection(collector.traceSpan({ actor: SERVICE_ACTOR, seam: crossTenant, name: 's', durationMs: 1, status: 'ok' }));
    const crossProject = { kind: 'gateway-audit', auditId: 'xga:0f1e2d3c', tenant: TENANT, project: 'project-OTHER' } as const;
    assertCrossScopeRejection(collector.traceSpan({ actor: SERVICE_ACTOR, seam: crossProject, name: 's', durationMs: 1, status: 'ok' }));
    expect(instants.remaining()).toBe(5);
  });

  it('rejects a log observation over a CROSS-SCOPE control-plane-audit seam — never burns the instant', () => {
    const { instants, collector } = freshCollector();
    const foreignSeam = { kind: 'control-plane-audit', sequence: 1, tenant: 'tenant-OTHER', project: 'project-OTHER' } as const;
    assertCrossScopeRejection(collector.logEntry({ actor: SERVICE_ACTOR, seam: foreignSeam, level: 'info', message: 'm' }));
    expect(instants.remaining()).toBe(5);
  });

  it('rejects observe() of a mirror-valid FOREIGN envelope (another tenant\u2019s real record) — never burns the instant', () => {
    const { instants, collector } = freshCollector();
    const foreignEnvelope = {
      id: 'msg-foreign-0001',
      topic: 'org.foreign.signals',
      tenantId: 'tenant-OTHER', // a REAL record of ANOTHER scope
      sender: 'inst-foreign-researcher',
      payload: 'FOREIGN-PAYLOAD',
      sequence: 1,
      causalityId: null,
      publishedAt: T0,
    };
    assertCrossScopeRejection(collector.observe(foreignEnvelope, { message: 'attempting to observe a foreign envelope' }));
    expect(instants.remaining()).toBe(5);
  });

  it('rejects observe() of a mirror-valid FOREIGN-scope gateway audit record — never burns the instant', () => {
    const { instants, collector } = freshCollector();
    const foreignGatewayRecord = {
      auditId: 'xga:9e8f7a6b',
      sequence: 1,
      who: { bodyVersion: { specId: 'spec-foreign', version: 1 }, intentRef: 'si:f1', decisionId: null, decisionKind: null, clientOrderId: 'cl-f1' },
      substrate: 'substrate:glm',
      policy: { policyId: 'xpol:1', version: 1 },
      visibleState: { venue: 'BINANCE', instrument: 'BTC-USDT', instrumentClass: 'crypto', referencePrice: '42000.00', rateWindowOrderCount: 0, riskExposureRef: null },
      riskChecks: { evaluationId: null, riskPolicy: { policyId: 'rpol:1', version: 1 }, within: 0, breaching: 0, blocked: 0 },
      order: null,
      execution: null,
      outcome: 'refused',
      refusal: { stage: 'kill-switch', code: 'thrown', detail: null },
      lineage: { intentRef: 'si:f1', strategy: { specId: 'spec-foreign', version: 1 }, goal: { goalId: 'goal-f1', version: 1 }, policy: { policyId: 'xpol:1', version: 1 }, venues: ['BINANCE'], seed: 'seed-f', tenant: 'tenant-OTHER', project: 'project-OTHER' },
      tenant: 'tenant-OTHER', // a REAL record of ANOTHER scope
      project: 'project-OTHER',
      asOf: T0,
      chainHead: '12345678',
    };
    assertCrossScopeRejection(collector.observe(foreignGatewayRecord, { message: 'attempting to observe a foreign audit record' }));
    expect(instants.remaining()).toBe(5);
  });

  it('the event-store seam carries no scope fields — the documented exception stays observable', () => {
    const { collector } = freshCollector();
    const event = {
      event_id: 'evt-any-venue',
      venue: 'COINBASE', // any venue, any tenant-uniform stream
      instrument: 'BTC-USD',
      asset_class: 'crypto',
      event_type: 'quote',
      event_time: T0,
      source_time: null,
      available_time: T0,
      ingestion_time: T0,
      sequence: 1,
      provider: 'coinbase',
      provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null },
      payload: { bid: '42000.00', ask: '42001.00' },
    };
    const observed = collector.observe(event, { message: 'venue-scoped seam observed' });
    expect(observed.ok).toBe(true);
  });
});
