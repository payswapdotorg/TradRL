/**
 * @tradrl/observability_service — the END-TO-END chain test.
 *
 * One flow, the whole law: a REAL T040 GatewayAuditRecord (minted by
 * the REAL @tradrl/execution-authority trail — tests-only relative
 * import, the repo's established D-004 pattern) is OBSERVED through
 * the collector (by identity, never by payload), alongside metric,
 * trace-span and log recordings; the grown log is chain-VERIFIED, its
 * records dispatched to the injected sinks in append order, QUERIED
 * under the L4 asOf discipline with the full WHO/WHICH filter surface,
 * REPLAYED byte-identically, and a TAMPERED copy fails verification
 * with the typed `audit_rewrite`. Cross-scope queries are typed
 * `tenant_missing` errors.
 *
 * This is the "chain verification is tested end-to-end" proof the Work
 * Order demands: every stage of the lane exercised in one scenario,
 * over a REAL cross-lane record.
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  type ProjectId,
  type TimestampMs,
  type TenantId,
} from '../../../packages/observability/src/index';
import { createObservabilityCollector } from './collector';
import { scriptedInstants, type TelemetrySink } from './ports';
import { canonicalTelemetryLogJson, replayTelemetryLog, verifyTelemetryLog, type TelemetryLog } from './log';
import { queryTelemetry } from './query';

// The REAL T040 package (tests only — relative import).
import {
  gatewayAuditRecordAt,
  mintAdapterDescriptorRef,
  mintChannelRef,
  startGatewayAuditTrail,
  type AdapterDescriptorRef,
  type CredentialRef,
  type GatewayAuditRecord,
} from '../../../packages/execution-authority/src/index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT = 'tenant-e2e' as TenantId;
const PROJECT = 'project-e2e' as ProjectId;
const OTHER_TENANT = 'tenant-e2e-other' as TenantId;

/** Unwrap a fixture result or fail loudly. */
function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

/** A REAL T040 gateway audit record, minted at a REAL trail's first position. */
function realT040Record(): GatewayAuditRecord {
  const trail = unwrap(startGatewayAuditTrail(TENANT, PROJECT));
  return unwrap(gatewayAuditRecordAt(trail, {
    who: {
      bodyVersion: { specId: 'spec-e2e-director', version: 2 },
      intentRef: 'si:e2e-0001',
      decisionId: 'xd:e2e0a1b2',
      decisionKind: 'approve',
      clientOrderId: 'cl-e2e-0001',
    },
    substrate: 'substrate:glm-4-plus',
    policy: { policyId: 'xpol:e2e-0001', version: 1 },
    visibleState: {
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      instrumentClass: 'crypto',
      referencePrice: '42000.00',
      rateWindowOrderCount: 3,
      riskExposureRef: 'exp:e2e-0001',
    },
    riskChecks: {
      evaluationId: 'rls:e2e-0001',
      riskPolicy: { policyId: 'rpol:e2e-0001', version: 1 },
      within: 5,
      breaching: 0,
      blocked: 0,
    },
    order: {
      adapterRef: mintAdapterDescriptorRef({ id: 'adapter-e2e-brokers', version: '1.0.0' }) as AdapterDescriptorRef,
      channelRef: mintChannelRef('newOrderSingle'),
      credentialRef: 'cred:e2e-broker@1' as CredentialRef,
      clientOrderId: 'cl-e2e-0001',
      requestRef: 'gor:e2e-0001',
    },
    execution: { routed: true, submissionAt: T0, messageDigest: '0e2e0e2e' },
    outcome: 'routed',
    refusal: null,
    lineage: {
      intentRef: 'si:e2e-0001',
      strategy: { specId: 'spec-e2e-director', version: 2 },
      goal: { goalId: 'goal-e2e-0001', version: 1 },
      policy: { policyId: 'xpol:e2e-0001', version: 1 },
      venues: ['BINANCE'],
      seed: 'e2e-seed-deterministic-0001',
      tenant: TENANT,
      project: PROJECT,
    },
    tenant: TENANT,
    project: PROJECT,
    asOf: T0,
  }));
}

// ---------------------------------------------------------------------------
// The end-to-end scenario
// ---------------------------------------------------------------------------

describe('the observability lane end-to-end (REAL T040 record -> collector -> chain -> query -> replay -> tamper)', () => {
  /** The full scenario's grown log + the sink's captured records. */
  function runScenario(): { log: TelemetryLog; sinkRecords: ReturnType<typeof recordingSink>['records']; t040: GatewayAuditRecord } {
    const t040 = realT040Record();
    const sink = recordingSink();
    // Four instants: one per record (the observation + metric + span + log).
    const instants = scriptedInstants([T0, T0 + 1_000, T0 + 2_000, T0 + 3_000]);
    const collector = unwrap(createObservabilityCollector({ tenant: TENANT, project: PROJECT, instants, sinks: [sink.sink] }));

    // 1. OBSERVE the REAL T040 record — by identity, never by payload.
    const observed = unwrap(collector.observe(t040, { message: 'routed submission observed', level: 'info' }));
    expect(observed.seam).toEqual({ kind: 'gateway-audit', auditId: t040.auditId, tenant: TENANT, project: PROJECT });
    expect(observed.recordedAt).toBe(T0);

    // 2-4. Record one of each remaining kind, over seams of THIS scope.
    unwrap(collector.metric({
      actor: { kind: 'service', ref: 'execution-gateway' },
      seam: { kind: 'gateway-audit', auditId: t040.auditId, tenant: TENANT, project: PROJECT },
      name: 'gateway.submissions',
      value: 1,
      unit: 'orders',
    }));
    unwrap(collector.traceSpan({
      actor: { kind: 'service', ref: 'execution-gateway' },
      seam: { kind: 'kernel-operation', opId: 'kop-e2e-0001', type: 'EXECUTE', tenant: TENANT },
      name: 'gate.evaluate',
      durationMs: 7,
      status: 'ok',
    }));
    unwrap(collector.logEntry({
      actor: { kind: 'operator', ref: 'ops-e2e-oncall' },
      seam: { kind: 'control-plane-audit', sequence: 1, tenant: TENANT, project: PROJECT },
      level: 'info',
      message: 'operator acknowledged the routed submission',
    }));
    expect(instants.remaining()).toBe(0); // exactly one instant per record
    return { log: collector.currentLog(), sinkRecords: sink.records, t040 };
  }

  /** A recording sink (captures every ingested record). */
  function recordingSink(): { sink: TelemetrySink; records: unknown[] } {
    const records: unknown[] = [];
    return { sink: { ingest: (record) => records.push(record) }, records };
  }

  it('grows one chain-verified log of four records over the REAL T040 observation', () => {
    const { log } = runScenario();
    expect(log.records).toHaveLength(4);
    expect(log.records.map((record) => record.sequence)).toEqual([1, 2, 3, 4]);
    expect(log.tenant).toBe(TENANT);
    expect(log.project).toBe(PROJECT);
    expect(verifyTelemetryLog(log).ok).toBe(true);
  });

  it('dispatches every record to the injected sinks in append order (the consumer port)', () => {
    const { log, sinkRecords } = runScenario();
    expect(sinkRecords.map((record) => (record as { recordId: string }).recordId)).toEqual(log.records.map((record) => record.recordId));
  });

  it('references the T040 record BY IDENTITY — the payload never enters the log (byte scan)', () => {
    const { log, t040 } = runScenario();
    const serialized = canonicalTelemetryLogJson(log);
    expect(serialized).toContain(t040.auditId); // the opaque join key IS referenced
    // The observed record's ACTOR is derived by identity projection (the WHO
    // of the observed submission — `specId@version`), exactly like the
    // envelope path derives `sender`; it is an identity reference, not a copy.
    expect(serialized).toContain('spec-e2e-director@2');
    // The T040 PAYLOAD VALUES — the facts of who/what/visible-state/risk/
    // order/execution/lineage — never enter the log:
    for (const forbidden of ['42000.00', 'e2e-seed-deterministic-0001', 'rls:e2e-0001', 'newOrderSingle', 'cl-e2e-0001', 'adapter-e2e-brokers', 'rpol:e2e-0001', 'xd:e2e0a1b2']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('queries the log under the L4 asOf discipline with the full WHO/WHICH filter surface', () => {
    const { log } = runScenario();
    // Everything as of the second record's instant (INCLUSIVE).
    const firstTwo = unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: (T0 + 1_000) as TimestampMs }));
    expect(firstTwo.map((record) => record.sequence)).toEqual([1, 2]);
    // The operator's log entries only (exact WHO).
    const operatorLogs = unwrap(queryTelemetry(log, {
      tenant: TENANT, project: PROJECT, asOf: (T0 + 10_000) as TimestampMs,
      actors: [{ kind: 'operator', ref: 'ops-e2e-oncall' }],
      kinds: ['log'],
    }));
    expect(operatorLogs.map((record) => record.sequence)).toEqual([4]);
    // Observations over the execution-plane seam only (WHICH seam).
    const executionPlane = unwrap(queryTelemetry(log, {
      tenant: TENANT, project: PROJECT, asOf: (T0 + 10_000) as TimestampMs,
      seamKinds: ['gateway-audit'],
    }));
    expect(executionPlane.map((record) => record.sequence)).toEqual([1, 2]);
    // Cross-scope reads are inexpressible (L12).
    const foreign = queryTelemetry(log, { tenant: OTHER_TENANT, project: PROJECT, asOf: T0 });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.errors[0]?.code).toBe('tenant_missing');
  });

  it('replays byte-identically (the determinism proof over the full scenario)', () => {
    const { log } = runScenario();
    const replayed = unwrap(replayTelemetryLog(log));
    expect(canonicalTelemetryLogJson(replayed)).toBe(canonicalTelemetryLogJson(log));
    expect(replayed).toEqual(log);
  });

  it('a TAMPERED copy of the scenario log fails verification with the typed audit_rewrite', () => {
    const { log } = runScenario();
    const records = log.records.map((record) => JSON.parse(JSON.stringify(record)) as typeof record);
    const victim = records[1] as { value: number };
    victim.value = 999; // flip the metric's value
    const tampered = { tenant: TENANT, project: PROJECT, records } as unknown as TelemetryLog;
    const verified = verifyTelemetryLog(tampered);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0]?.code).toBe('audit_rewrite');
    // And the tampered log cannot replay either (the fold enforces the law).
    expect(replayTelemetryLog(tampered).ok).toBe(false);
  });

  it('the whole scenario is DETERMINISTIC — two runs produce byte-identical logs and digests', () => {
    const digestOf = (log: TelemetryLog): string => canonicalJson(log.records.map((record) => ({ recordId: record.recordId, chainHead: record.chainHead })));
    const first = runScenario();
    const second = runScenario();
    expect(digestOf(first.log)).toBe(digestOf(second.log));
    expect(canonicalTelemetryLogJson(first.log)).toBe(canonicalTelemetryLogJson(second.log));
    // The REAL T040 record itself mints identically in both runs (content-addressed join key).
    expect(first.t040.auditId).toBe(second.t040.auditId);
  });
});
