/**
 * @tradrl/security-service — the composition-root tests.
 *
 * Pins: every act is enforced + accounted + audited; denials are audited
 * (cross-tenant attempts by registered scopes land in the ACTOR's trail
 * with decision 'denied'); the trails chain-verify; usage counters
 * advance; the snapshot is JSON-safe.
 */
import { describe, expect, it } from 'vitest';

import {
  credentialFingerprint,
  mintIsolationDescriptor,
  type EnvironmentSpec,
  type ProjectId,
  type Scope,
  type TenantId,
  type TimestampMs,
} from '../../../packages/security/src/index';
import {
  contextAdmitEpisode,
  contextAuditTrail,
  contextDepositSecret,
  contextEnvelopes,
  contextExportScope,
  contextGetRecord,
  contextListRecords,
  contextPutRecord,
  contextRegisterEnvelope,
  contextRegisterProject,
  contextRegisterTenant,
  contextResolveCredential,
  contextOnUsage,
  contextSnapshot,
  contextUsage,
  contextVerifyAllTrails,
  createSecurityContext,
  type UsageEvent,
} from './index';

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT_A = 'tenant-ctx-a' as TenantId;
const TENANT_B = 'tenant-ctx-b' as TenantId;
const PROJECT = 'project-ctx' as ProjectId;
const SCOPE_A: Scope = { tenant: TENANT_A, project: PROJECT };
const SCOPE_B: Scope = { tenant: TENANT_B, project: PROJECT };
const SECRET = 'AKIA-CTX-CANARY-zz99';

function setup() {
  const context = createSecurityContext();
  expect(contextRegisterTenant(context, TENANT_A, T0).ok).toBe(true);
  expect(contextRegisterTenant(context, TENANT_B, (T0 + 1) as TimestampMs).ok).toBe(true);
  expect(contextRegisterProject(context, SCOPE_A, (T0 + 2) as TimestampMs).ok).toBe(true);
  expect(contextRegisterProject(context, SCOPE_B, (T0 + 3) as TimestampMs).ok).toBe(true);
  return context;
}

function specFixture(): EnvironmentSpec {
  return {
    profile: {
      environment_id: 'env-ctx' as EnvironmentSpec['profile']['environment_id'],
      fidelity: 'exact_replay',
      clock: { now: T0, asOf: (T0 + 86_400_000) as TimestampMs, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' },
      seed: 'seed-ctx' as EnvironmentSpec['profile']['seed'],
      venue_scope: [] as unknown as EnvironmentSpec['profile']['venue_scope'],
      instrument_scope: [] as unknown as EnvironmentSpec['profile']['instrument_scope'],
      latency_policy: null,
      fee_policy: null,
    },
    world: { world_id: 'world-ctx' as EnvironmentSpec['world']['world_id'], kind: 'stub' },
    information_policy: 'point-in-time',
  };
}

function descriptorFixture(tenant: TenantId, project: ProjectId) {
  const result = mintIsolationDescriptor({
    workloadKind: 'episode', egress: 'none', networkAllowlist: [], filesystem: 'scratch',
    credentialAccess: 'envelope_refs_only', maxSteps: 100, tenant, project, asOf: T0,
  });
  if (!result.ok) throw new Error('fixture');
  return result.value;
}


/** Narrowing helper: one scope's usage field (or -1 when the read fails). */
function usageField(context: ReturnType<typeof createSecurityContext>, scope: Scope, field: 'recordWrites' | 'credentialResolutions' | 'episodesAdmitted' | 'exports' | 'eventCount'): number {
  const usage = contextUsage(context, scope);
  return usage.ok ? usage.value[field] : -1;
}

describe('the audited lifecycle', () => {
  it("tenant + project registration land in their trails; every trail chain-verifies", () => {
    const context = setup();
    // The tenant registration is a TENANT-level fact: it lands in the tenant's bootstrap trail (scope tenant/tenant).
    const bootstrap = contextAuditTrail(context, { tenant: TENANT_A, project: TENANT_A as unknown as ProjectId });
    expect(bootstrap).not.toBeNull();
    expect(bootstrap!.records.map((r) => r.action)).toEqual(['tenant_registered']);
    // The project registration lands in the project's own trail.
    const trail = contextAuditTrail(context, SCOPE_A);
    expect(trail).not.toBeNull();
    expect(trail!.records.map((r) => r.action)).toEqual(['project_registered']);
    expect(trail!.records.every((r) => r.decision === 'allowed')).toBe(true);
    expect(contextVerifyAllTrails(context)).toBe(0);
  });

  it('record writes are enforced, audited and usage-accounted', () => {
    const context = setup();
    const written = contextPutRecord(context, 'data', { tenant: TENANT_A, project: PROJECT, record_id: 'd1', payload: { note: 'alpha fact' }, asOf: (T0 + 10) as TimestampMs });
    expect(written.ok).toBe(true);
    const trail = contextAuditTrail(context, SCOPE_A)!;
    expect(trail.records.map((r) => r.action)).toContain('record_written');
    const usage = contextUsage(context, SCOPE_A);
    expect(usage.ok && usage.value.recordWrites).toBe(1);
  });

  it('a credential write smuggling a value is refused AND audited nowhere (the gate precedes the audit)', () => {
    const context = setup();
    const smuggled = contextPutRecord(context, 'credentials', { tenant: TENANT_A, project: PROJECT, record_id: 'c1', payload: { apiKey: 'REAL-SECRET' }, asOf: (T0 + 10) as TimestampMs });
    expect(smuggled.ok).toBe(false);
    if (!smuggled.ok) expect(smuggled.errors[0]!.code).toBe('credential_value_present');
    const trail = contextAuditTrail(context, SCOPE_A)!;
    expect(trail.records.map((r) => r.action)).not.toContain('record_written');
  });
});

describe('the secrets boundary through the context', () => {
  it('register + deposit + resolve round-trip; every step audited; usage counted; snapshot secret-free', () => {
    const context = setup();
    const envelope = contextRegisterEnvelope(context, {
      tenant: TENANT_A, project: PROJECT, venue: null, kind: 'api_key',
      fingerprint: credentialFingerprint(SECRET), asOf: (T0 + 10) as TimestampMs,
    });
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const envelopeId = envelope.value.envelopeId;
    expect(contextDepositSecret(context, { envelopeId, version: 1 }, SECRET, (T0 + 11) as TimestampMs).ok).toBe(true);
    const resolution = contextResolveCredential(context, SCOPE_A, { envelopeId, version: 1 }, 'runtime:research', (T0 + 12) as TimestampMs);
    expect(resolution.ok && resolution.value).toBe(SECRET);
    // Audited: envelope registered, deposited, resolved.
    const trail = contextAuditTrail(context, SCOPE_A)!;
    expect(trail.records.map((r) => r.action)).toEqual(expect.arrayContaining(['credential_envelope_registered', 'secret_deposited', 'credential_resolved']));
    // Usage: one resolution.
    expect(usageField(context, SCOPE_A, 'credentialResolutions')).toBe(1);
    // The envelope reference landed on the tenant-isolated credentials surface.
    expect(contextListRecords(context, 'credentials', SCOPE_A).map((r) => r.record_id)).toEqual([`envelope:${envelopeId}`]);
    // Snapshot + trails + envelopes are ALL secret-free.
    expect(JSON.stringify(contextSnapshot(context))).not.toContain(SECRET);
    expect(JSON.stringify(contextEnvelopes(context))).not.toContain(SECRET);
  });

  it('a cross-tenant resolution attempt is refused AND audited as a denial in the ACTOR trail', () => {
    const context = setup();
    const envelope = contextRegisterEnvelope(context, {
      tenant: TENANT_A, project: PROJECT, venue: null, kind: 'api_key',
      fingerprint: credentialFingerprint(SECRET), asOf: (T0 + 10) as TimestampMs,
    });
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const envelopeId = envelope.value.envelopeId;
    expect(contextDepositSecret(context, { envelopeId, version: 1 }, SECRET, (T0 + 11) as TimestampMs).ok).toBe(true);
    const attempt = contextResolveCredential(context, SCOPE_B, { envelopeId, version: 1 }, 'runtime:evil', (T0 + 12) as TimestampMs);
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.refusal.kind).toBe('cross_tenant_access');
    // B's trail carries the denial; A's trail does NOT carry B's attempt.
    const trailB = contextAuditTrail(context, SCOPE_B)!;
    expect(trailB.records.map((r) => r.action)).toContain('cross_tenant_access_denied');
    expect(trailB.records.find((r) => r.action === 'cross_tenant_access_denied')!.decision).toBe('denied');
    const trailA = contextAuditTrail(context, SCOPE_A)!;
    expect(trailA.records.map((r) => r.action)).not.toContain('cross_tenant_access_denied');
    expect(contextVerifyAllTrails(context)).toBe(0);
  });
});

describe('episode admission through the context', () => {
  it('a lawful admission stores the lineage fact, audits it and counts usage; a descriptor-less one is refused AND audited', () => {
    const context = setup();
    const admitted = contextAdmitEpisode(context, {
      scope: SCOPE_A, spec: specFixture(), descriptor: descriptorFixture(TENANT_A, PROJECT),
      admittedBy: 'operator:ada', admittedAt: (T0 + 20) as TimestampMs,
    });
    expect(admitted.ok).toBe(true);
    expect(contextListRecords(context, 'trajectories', SCOPE_A)).toHaveLength(1);
    expect(contextAuditTrail(context, SCOPE_A)!.records.map((r) => r.action)).toContain('episode_admitted');
    expect(usageField(context, SCOPE_A, 'episodesAdmitted')).toBe(1);

    const refused = contextAdmitEpisode(context, {
      scope: SCOPE_A, spec: specFixture(), descriptor: null,
      admittedBy: 'operator:ada', admittedAt: (T0 + 21) as TimestampMs,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.refusal.kind).toBe('isolation_violation');
    const trail = contextAuditTrail(context, SCOPE_A)!;
    expect(trail.records.map((r) => r.action)).toContain('episode_admission_refused');
    expect(trail.records.find((r) => r.action === 'episode_admission_refused')!.decision).toBe('denied');
    // Still exactly one stored admission (refusals store nothing).
    expect(contextListRecords(context, 'trajectories', SCOPE_A)).toHaveLength(1);
  });

  it('usage hooks fire for every accounted act', () => {
    const context = setup();
    const seen: UsageEvent[] = [];
    contextOnUsage(context, (event) => seen.push(event));
    contextPutRecord(context, 'data', { tenant: TENANT_A, project: PROJECT, record_id: 'd1', payload: 0, asOf: (T0 + 30) as TimestampMs });
    expect(seen.map((e) => e.kind)).toEqual(['record_write']);
  });
});

describe('exports through the context', () => {
  it('exports are audited, usage-counted and R42-clean', () => {
    const context = setup();
    contextPutRecord(context, 'data', { tenant: TENANT_A, project: PROJECT, record_id: 'a1', payload: { only: 'alpha' }, asOf: (T0 + 40) as TimestampMs });
    contextPutRecord(context, 'data', { tenant: TENANT_B, project: PROJECT, record_id: 'b1', payload: { only: 'beta' }, asOf: (T0 + 41) as TimestampMs });
    const exported = contextExportScope(context, SCOPE_A, (T0 + 50) as TimestampMs);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(JSON.stringify(exported.value)).not.toContain('beta');
    expect(contextAuditTrail(context, SCOPE_A)!.records.map((r) => r.action)).toContain('scope_exported');
    expect(usageField(context, SCOPE_A, 'exports')).toBe(1);
    expect(contextVerifyAllTrails(context)).toBe(0);
  });
});
