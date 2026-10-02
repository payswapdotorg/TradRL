/**
 * T044 INTEGRATION — R42: export excludes other-tenant data.
 *
 * THE LAW (spec/REQUIREMENTS.md R42: export/import without customer
 * leakage; spec/SECURITY.md Tenant isolation: "Do not reuse customer
 * data for another tenant by default.") — enforced and PROVEN:
 *
 *   1. STRUCTURAL EXCLUSION: the bundle builder walks only the
 *      exporting scope's own indexes;
 *   2. VALIDATED EXCLUSION: `validateExportBundle` re-proves every
 *      record in a bundle carries the exporting scope — a smuggled
 *      foreign record is the typed `export_scope_violation`;
 *   3. BYTES: the serialized bundle contains NONE of the other
 *      tenants' ids, payloads or canaries — proven by byte-scan over a
 *      rich two-tenant world (including same-record-id collisions);
 *   4. SECRET-FREEDOM: the bundle carries envelopes (references), never
 *      values (the opacity wire runs over the whole bundle);
 *   5. DETERMINISM: identical worlds produce identical bundle ids.
 */
import { describe, expect, it } from 'vitest';

import { credentialFingerprint, type ProjectId, type Scope, type TenantId, type TimestampMs } from '../../packages/security/src/index';
import {
  contextDepositSecret,
  contextEnvelopes,
  contextExportScope,
  contextPutRecord,
  contextRegisterEnvelope,
  contextRegisterProject,
  contextRegisterTenant,
  contextResolveCredential,
  createSecurityContext,
  validateExportBundle,
} from '../../services/security/src/index';

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT_A = 'tenant-export-acme' as TenantId;
const TENANT_B = 'tenant-export-globex' as TenantId;
const TENANT_C = 'tenant-export-initech' as TenantId;
const PROJECT = 'project-export' as ProjectId;
const SCOPE_A: Scope = { tenant: TENANT_A, project: PROJECT };
const SCOPE_B: Scope = { tenant: TENANT_B, project: PROJECT };
const SCOPE_C: Scope = { tenant: TENANT_C, project: PROJECT };

/** The other tenants' customer data — the strings that must NEVER appear in A's bundle. */
const B_CANARIES = ['GLOBEX-CUSTOMER-FACT-1aa', 'GLOBEX-MEMORY-FACT-2bb', 'GLOBEX-TRAJECTORY-FACT-3cc'];
const C_CANARIES = ['INITECH-ARTIFACT-FACT-4dd'];

function richThreeTenantWorld() {
  const context = createSecurityContext();
  for (const [index, scope] of [SCOPE_A, SCOPE_B, SCOPE_C].entries()) {
    expect(contextRegisterTenant(context, scope.tenant, (T0 + index) as TimestampMs).ok).toBe(true);
    expect(contextRegisterProject(context, scope, (T0 + 10 + index) as TimestampMs).ok).toBe(true);
  }
  // A's own records.
  expect(contextPutRecord(context, 'data', { tenant: TENANT_A, project: PROJECT, record_id: 'acme-data-1', payload: { fact: 'ACME-OWN-FACT-5ee' }, asOf: (T0 + 20) as TimestampMs }).ok).toBe(true);
  expect(contextPutRecord(context, 'memory', { tenant: TENANT_A, project: PROJECT, record_id: 'acme-memory-1', payload: { lesson: 'ACME-OWN-LESSON-6ff' }, asOf: (T0 + 21) as TimestampMs }).ok).toBe(true);
  // B's records — including a record with the SAME id as one of A's (collision probe).
  expect(contextPutRecord(context, 'data', { tenant: TENANT_B, project: PROJECT, record_id: 'acme-data-1', payload: { fact: B_CANARIES[0] }, asOf: (T0 + 22) as TimestampMs }).ok).toBe(true);
  expect(contextPutRecord(context, 'memory', { tenant: TENANT_B, project: PROJECT, record_id: 'globex-memory-9', payload: { lesson: B_CANARIES[1] }, asOf: (T0 + 23) as TimestampMs }).ok).toBe(true);
  expect(contextPutRecord(context, 'trajectories', { tenant: TENANT_B, project: PROJECT, record_id: 'globex-traj-3', payload: { steps: [1, 2, 3], note: B_CANARIES[2] }, asOf: (T0 + 24) as TimestampMs }).ok).toBe(true);
  // C's records.
  expect(contextPutRecord(context, 'artifacts', { tenant: TENANT_C, project: PROJECT, record_id: 'initech-report-2', payload: { note: C_CANARIES[0] }, asOf: (T0 + 25) as TimestampMs }).ok).toBe(true);
  // A's credential (envelope + deposited value; the bundle carries the envelope only).
  const envelope = contextRegisterEnvelope(context, {
    tenant: TENANT_A, project: PROJECT, venue: null, kind: 'api_key',
    fingerprint: credentialFingerprint('ACME-EXPORT-SECRET-never-in-bundles'), asOf: (T0 + 30) as TimestampMs,
  });
  expect(envelope.ok).toBe(true);
  if (envelope.ok) {
    expect(contextDepositSecret(context, { envelopeId: envelope.value.envelopeId, version: 1 }, 'ACME-EXPORT-SECRET-never-in-bundles', (T0 + 31) as TimestampMs).ok).toBe(true);
    // A resolves (audited + accounted) so the export's usage block is non-trivial.
    contextResolveCredential(context, SCOPE_A, { envelopeId: envelope.value.envelopeId, version: 1 }, 'runtime:research', (T0 + 32) as TimestampMs);
  }
  // B's credential too (must not leak into A's bundle).
  const envelopeB = contextRegisterEnvelope(context, {
    tenant: TENANT_B, project: PROJECT, venue: null, kind: 'api_key',
    fingerprint: credentialFingerprint('GLOBEX-EXPORT-SECRET-never-in-bundles'), asOf: (T0 + 33) as TimestampMs,
  });
  expect(envelopeB.ok).toBe(true);
  return { context, envelopeIdA: envelope.ok ? envelope.value.envelopeId : '' };
}

describe('R42 integration: export excludes other-tenant data', () => {
  it("A's bundle contains A's facts and NONE of B/C's (byte-scan over the rich world)", () => {
    const { context } = richThreeTenantWorld();
    const exported = contextExportScope(context, SCOPE_A, (T0 + 100) as TimestampMs);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const serialized = JSON.stringify(exported.value);
    // A's own facts ARE present (export is useful, not empty).
    expect(serialized).toContain('ACME-OWN-FACT-5ee');
    expect(serialized).toContain('ACME-OWN-LESSON-6ff');
    // B's and C's customer data is ABSENT — every canary, every record id unique to them.
    for (const canary of [...B_CANARIES, ...C_CANARIES]) {
      expect(serialized, `canary ${canary} leaked`).not.toContain(canary);
    }
    expect(serialized).not.toContain('globex-memory-9');
    expect(serialized).not.toContain('globex-traj-3');
    expect(serialized).not.toContain('initech-report-2');
    expect(serialized).not.toContain('tenant-export-globex');
    expect(serialized).not.toContain('tenant-export-initech');
    // The same-id collision probe: A's 'acme-data-1' is A's OWN payload, not B's.
    const dataSurface = exported.value.records.find((r) => r.surface === 'data')!;
    const collision = dataSurface.records.find((r) => r.record_id === 'acme-data-1')!;
    expect((collision.payload as { fact: string }).fact).toBe('ACME-OWN-FACT-5ee');
    // Secret-freedom: A's envelope IS present (a reference), its value NEVER.
    expect(serialized).toContain(contextEnvelopes(context).find((e) => e.tenant === TENANT_A)!.envelopeId);
    expect(serialized).not.toContain('ACME-EXPORT-SECRET');
    expect(serialized).not.toContain('GLOBEX-EXPORT-SECRET');
  });

  it('every record in the bundle carries the exporting scope (validateExportBundle re-proves it)', () => {
    const { context } = richThreeTenantWorld();
    const exported = contextExportScope(context, SCOPE_A, (T0 + 100) as TimestampMs);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    for (const surface of exported.value.records) {
      for (const record of surface.records) {
        expect(record.tenant).toBe(TENANT_A);
        expect(record.project).toBe(PROJECT);
      }
    }
    expect(validateExportBundle(exported.value, SCOPE_A).ok).toBe(true);
  });

  it('a smuggled foreign record is the typed export_scope_violation (validation catches what a compiler cannot)', () => {
    const { context } = richThreeTenantWorld();
    const exported = contextExportScope(context, SCOPE_A, (T0 + 100) as TimestampMs);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    // Smuggle B's memory record into a re-serialized bundle (the import-side attack).
    const tampered = JSON.parse(JSON.stringify(exported.value)) as unknown as typeof exported.value;
    (tampered.records.find((r) => r.surface === 'memory')!.records as unknown as unknown[]).push({
      record_id: 'globex-memory-9',
      surface: 'memory',
      payload: { lesson: B_CANARIES[1] },
      asOf: (T0 + 23) as TimestampMs,
      tenant: TENANT_B,
      project: PROJECT,
    });
    const result = validateExportBundle(tampered, SCOPE_A);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.code).toBe('export_scope_violation');
      expect(result.errors[0]!.message).toContain('R42');
    }
  });

  it('a smuggled VALUE in a bundle is the typed credential_value_present (the wire runs over the whole bundle)', () => {
    const { context } = richThreeTenantWorld();
    const exported = contextExportScope(context, SCOPE_A, (T0 + 100) as TimestampMs);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const tampered = JSON.parse(JSON.stringify(exported.value)) as typeof exported.value;
    (tampered.records[0]!.records[0] as { payload: Record<string, unknown> }).payload = { apiKey: 'SMUGGLED-VALUE' };
    const result = validateExportBundle(tampered, SCOPE_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('credential_value_present');
  });

  it('determinism: the identical world exported twice yields the identical bundle id; any change changes it', () => {
    const first = richThreeTenantWorld();
    const second = richThreeTenantWorld();
    const export1 = contextExportScope(first.context, SCOPE_A, (T0 + 100) as TimestampMs);
    const export2 = contextExportScope(second.context, SCOPE_A, (T0 + 100) as TimestampMs);
    expect(export1.ok && export2.ok).toBe(true);
    if (export1.ok && export2.ok) {
      expect(export2.value.bundleId).toBe(export1.value.bundleId);
      expect(JSON.stringify(export2.value.records)).toBe(JSON.stringify(export1.value.records));
    }
    // A later export (after another A write) changes the bundle id.
    expect(contextPutRecord(second.context, 'data', { tenant: TENANT_A, project: PROJECT, record_id: 'acme-data-2', payload: { fact: 'MORE' }, asOf: (T0 + 101) as TimestampMs }).ok).toBe(true);
    const export3 = contextExportScope(second.context, SCOPE_A, (T0 + 102) as TimestampMs);
    expect(export3.ok).toBe(true);
    if (export3.ok && export1.ok) expect(export3.value.bundleId).not.toBe(export1.value.bundleId);
  });

  it('cross-tenant export attempts are refused at the door (unregistered scope)', () => {
    const context = createSecurityContext();
    expect(contextRegisterTenant(context, TENANT_A, T0).ok).toBe(true);
    expect(contextRegisterProject(context, SCOPE_A, (T0 + 1) as TimestampMs).ok).toBe(true);
    // B never registered: exporting B's scope is tenant_missing.
    const attempt = contextExportScope(context, SCOPE_B, (T0 + 2) as TimestampMs);
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.errors[0]!.code).toBe('tenant_missing');
  });
});
