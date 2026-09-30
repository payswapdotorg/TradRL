/**
 * @tradrl/audit — the complement law tests.
 *
 * THE LAW (the Work Order): "Complement, not duplicate: a platform
 * record references a T040 audit record ONLY as an opaque
 * `{ kind, auditId, tenant, project }` ref — a test byte-scans
 * serialized platform records to prove no T040 payload is copied in."
 *
 * This file builds a REAL T040 `GatewayAuditRecord` with the REAL
 * `@tradrl/execution-authority` package (relative import — tests
 * only), references it from a platform audit record, serializes the
 * platform record, and byte-scans the serialization: the join key IS
 * present; every distinctive T040 payload VALUE is NOT.
 */

import { describe, expect, it } from 'vitest';

import type { ProjectId, TimestampMs, TenantId } from '../../../packages/observability/src/index';
import {
  appendPlatformAuditRecord,
  canonicalPlatformAuditTrailJson,
  platformAuditRecordAt,
  platformAuditRecordTree,
  startPlatformAuditTrail,
  verifyPlatformAuditChain,
  type GatewayAuditObjectRef,
  type PlatformAuditRecord,
} from './platform-audit';

// The REAL T040 package (tests only — relative import).
import {
  appendGatewayAuditRecord as appendT040Record,
  gatewayAuditRecordAt,
  mintAdapterDescriptorRef,
  mintChannelRef,
  startGatewayAuditTrail,
  verifyGatewayAuditChain,
  type CredentialRef,
  type GatewayAuditRecord,
} from '../../../packages/execution-authority/src/index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT = 'tenant-complement' as TenantId;
const PROJECT = 'project-complement' as ProjectId;

/** Unwrap a fixture result or fail loudly. */
function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

/** A REAL T040 gateway audit record, minted by the REAL trail minter. */
function realGatewayAuditRecord(): GatewayAuditRecord {
  const trail = unwrap(startGatewayAuditTrail(TENANT, PROJECT));
  return unwrap(gatewayAuditRecordAt(trail, {
    who: {
      bodyVersion: { specId: 'spec-complement-director', version: 4 },
      intentRef: 'si:complement-0001',
      decisionId: 'xd:feedface',
      decisionKind: 'approve',
      clientOrderId: 'cl-complement-secret-0001',
    },
    substrate: 'substrate:complement-opaque-9999',
    policy: { policyId: 'xpol:complement-0001', version: 7 },
    visibleState: {
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      instrumentClass: 'crypto',
      referencePrice: '42424.42',
      rateWindowOrderCount: 3,
      riskExposureRef: 'exp:complement-0001',
    },
    riskChecks: {
      evaluationId: 'rls:complement-0001',
      riskPolicy: { policyId: 'rpol:complement-0001', version: 2 },
      within: 5,
      breaching: 0,
      blocked: 0,
    },
    order: {
      adapterRef: mintAdapterDescriptorRef({ id: 'adapter-brokers', version: '9.9.9' }),
      channelRef: mintChannelRef('newOrderSingle'),
      credentialRef: 'cred:complement-broker@1' as CredentialRef,
      clientOrderId: 'cl-complement-secret-0001',
      requestRef: 'gor:complement-0001',
    },
    execution: { routed: true, submissionAt: T0, messageDigest: '0d0d0d0d' },
    outcome: 'routed',
    refusal: null,
    lineage: {
      intentRef: 'si:complement-0001',
      strategy: { specId: 'spec-complement-director', version: 4 },
      goal: { goalId: 'goal-complement-0001', version: 1 },
      policy: { policyId: 'xpol:complement-0001', version: 7 },
      venues: ['BINANCE'],
      seed: 'complement-seed-deterministic-7734',
      tenant: TENANT,
      project: PROJECT,
    },
    tenant: TENANT,
    project: PROJECT,
    asOf: T0,
  }));
}

// ---------------------------------------------------------------------------
// The complement byte scan
// ---------------------------------------------------------------------------

describe('the complement law (T040 referenced by id, never re-audited)', () => {
  it('builds a REAL T040 record and a REAL platform record referencing it', () => {
    const gatewayRecord = realGatewayAuditRecord();
    // The T040 record is genuinely valid in its own lane.
    const t040Trail = unwrap(startGatewayAuditTrail(TENANT, PROJECT));
    const appended = appendT040Record(t040Trail, gatewayRecord);
    expect(appended.ok).toBe(true);
    if (appended.ok) expect(verifyGatewayAuditChain(appended.value).ok).toBe(true);

    // The platform record references it through the opaque complement ref.
    let trail = unwrap(startPlatformAuditTrail(TENANT, PROJECT));
    const ref: GatewayAuditObjectRef = { kind: 'gateway-audit', auditId: gatewayRecord.auditId, tenant: TENANT, project: PROJECT };
    const minted = unwrap(platformAuditRecordAt(trail, {
      actor: { kind: 'operator', ref: 'ops-compliance-auditor' },
      action: 'audit.exported',
      object: ref,
      at: (T0 + 60_000) as TimestampMs,
      tenant: TENANT,
      project: PROJECT,
      lineage: { goal: { goalId: 'goal-complement-0001', version: 1 }, project: PROJECT },
    }));
    trail = unwrap(appendPlatformAuditRecord(trail, minted));
    expect(verifyPlatformAuditChain(trail).ok).toBe(true);
  });

  it('BYTE SCAN — the serialized platform record carries the join key but NO T040 payload', () => {
    const gatewayRecord = realGatewayAuditRecord();
    let trail = unwrap(startPlatformAuditTrail(TENANT, PROJECT));
    const minted = unwrap(platformAuditRecordAt(trail, {
      actor: { kind: 'operator', ref: 'ops-compliance-auditor' },
      action: 'audit.exported',
      object: { kind: 'gateway-audit', auditId: gatewayRecord.auditId, tenant: TENANT, project: PROJECT },
      at: (T0 + 60_000) as TimestampMs,
      tenant: TENANT,
      project: PROJECT,
      lineage: { goal: { goalId: 'goal-complement-0001', version: 1 }, project: PROJECT },
    }));
    trail = unwrap(appendPlatformAuditRecord(trail, minted));

    const serializedRecord = JSON.stringify(platformAuditRecordTree(minted));
    const serializedTrail = canonicalPlatformAuditTrailJson(trail);

    // The join key IS present (the reference is real).
    expect(serializedRecord).toContain(gatewayRecord.auditId);
    expect(serializedRecord).toContain('"kind":"gateway-audit"');

    // NO T040 payload value is copied in — the distinctive values of every
    // T040 block, byte-scanned:
    const forbiddenPayloadValues = [
      // who block
      'spec-complement-director',
      'si:complement-0001',
      'xd:feedface',
      'cl-complement-secret-0001',
      // substrate / policy / visible state
      'substrate:complement-opaque-9999',
      'xpol:complement-0001',
      '42424.42',
      'exp:complement-0001',
      // risk checks
      'rls:complement-0001',
      'rpol:complement-0001',
      // order / execution
      'adapter-brokers',
      'newOrderSingle',
      'cred:complement-broker@1',
      'gor:complement-0001',
      '0d0d0d0d',
      // lineage
      'complement-seed-deterministic-7734',
    ];
    for (const forbidden of forbiddenPayloadValues) {
      expect(serializedRecord).not.toContain(forbidden);
      expect(serializedTrail).not.toContain(forbidden);
    }
  });

  it('the complement ref carries EXACTLY the four Work Order fields — nothing else', () => {
    const gatewayRecord = realGatewayAuditRecord();
    const ref: GatewayAuditObjectRef = { kind: 'gateway-audit', auditId: gatewayRecord.auditId, tenant: TENANT, project: PROJECT };
    expect(Object.keys(ref).sort()).toEqual(['auditId', 'kind', 'project', 'tenant']);
  });

  it('a platform record over a platform OBJECT (not a T040 ref) works identically — the chain is action-agnostic', () => {
    let trail = unwrap(startPlatformAuditTrail(TENANT, PROJECT));
    const minted = unwrap(platformAuditRecordAt(trail, {
      actor: { kind: 'service', ref: 'release-automation' },
      action: 'release.deployed',
      object: { kind: 'platform-object', objectType: 'release', ref: 'rel-2024-06-04-01' },
      at: T0,
      tenant: TENANT,
      project: PROJECT,
      lineage: { goal: null, project: PROJECT },
    }));
    trail = unwrap(appendPlatformAuditRecord(trail, minted));
    expect(verifyPlatformAuditChain(trail).ok).toBe(true);
    const record: PlatformAuditRecord = trail.records[0] as PlatformAuditRecord;
    expect(record.object.kind).toBe('platform-object');
  });
});
