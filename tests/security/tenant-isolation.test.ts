/**
 * T044 INTEGRATION — tenant isolation across EVERY registry surface.
 *
 * THE LAW (L12; spec/SECURITY.md Tenant isolation; PROJECT-STATE
 * invariant 8): tenant A's data/memory/trajectories/artifacts/
 * credentials/usage are INVISIBLE to tenant B — on every surface, in
 * every read shape:
 *
 *   1. B's LIST never contains A's records (scope-pure listing);
 *   2. B's GET of A's record is the TYPED cross_tenant_access error
 *      naming both scopes (never a silent miss, never a payload leak);
 *   3. B's EXPORT bundle never contains A's records (R42 — see
 *      export-r42.test.ts for the deep proof);
 *   4. B's USAGE read never counts A's acts;
 *   5. B cannot admit a workload under A's descriptor, and B cannot
 *      resolve A's credentials.
 *
 * Drives the REAL enforcement service (@tradrl/security-service) and the
 * REAL contracts package (@tradrl/security) via relative imports.
 */
import { describe, expect, it } from 'vitest';

import { credentialFingerprint, mintIsolationDescriptor, type EnvironmentSpec, type ProjectId, type Scope, type TenantId, type TimestampMs } from '../../packages/security/src/index';
import {
  ISOLATION_SURFACES,
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
  contextUsage,
  contextVerifyAllTrails,
  createSecurityContext,
  createTenantIsolationRegistry,
  putScopedRecord as rawPut,
  registerProject as rawRegisterProject,
  registerTenant as rawRegisterTenant,
  type IsolationSurface,
} from '../../services/security/src/index';

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT_A = 'tenant-acme' as TenantId;
const TENANT_B = 'tenant-globex' as TenantId;
const PROJECT_A = 'project-alpha' as ProjectId;
const PROJECT_B = 'project-beta' as ProjectId;
const SCOPE_A: Scope = { tenant: TENANT_A, project: PROJECT_A };
const SCOPE_B: Scope = { tenant: TENANT_B, project: PROJECT_B };

/** The per-surface canary payloads tenant A writes; the tests prove B never sees ANY of them. */
const A_PAYLOADS: Record<IsolationSurface, { payload: unknown; id: string }> = {
  data: { id: 'acme-market-data-1', payload: { canary: 'ACME-DATA-CANARY-77a1', rows: 100 } },
  projects: { id: 'acme-project-brief', payload: { canary: 'ACME-PROJECT-CANARY-77a2', goal: 'alpha returns' } },
  trajectories: { id: 'acme-trajectory-42', payload: { canary: 'ACME-TRAJECTORY-CANARY-77a3', steps: 42 } },
  memory: { id: 'acme-firm-memory-9', payload: { canary: 'ACME-MEMORY-CANARY-77a4', lesson: 'mean reversion fails in trends' } },
  artifacts: { id: 'acme-backtest-report', payload: { canary: 'ACME-ARTIFACT-CANARY-77a5', sharpe: 1.9 } },
  credentials: { id: 'acme-envelope-ref', payload: { envelopeId: 'cred:acme1', canary: 'ACME-CREDENTIAL-CANARY-77a6' } },
  usage: { id: 'acme-usage-event', payload: { canary: 'ACME-USAGE-CANARY-77a7', units: 3 } },
};

/** A minimal B-scope episode spec (the T005 mirror shape). */
const specB: EnvironmentSpec = {
  profile: {
    environment_id: 'env-globex-1' as EnvironmentSpec['profile']['environment_id'],
    fidelity: 'exact_replay',
    clock: { now: T0, asOf: (T0 + 1_000) as TimestampMs, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' },
    seed: 'seed-globex' as EnvironmentSpec['profile']['seed'],
    venue_scope: [] as unknown as EnvironmentSpec['profile']['venue_scope'],
    instrument_scope: [] as unknown as EnvironmentSpec['profile']['instrument_scope'],
    latency_policy: null,
    fee_policy: null,
  },
  world: { world_id: 'world-globex-stub' as EnvironmentSpec['world']['world_id'], kind: 'stub' },
  information_policy: 'point-in-time',
};

function setupTwoTenants() {
  const context = createSecurityContext();
  expect(contextRegisterTenant(context, TENANT_A, T0).ok).toBe(true);
  expect(contextRegisterTenant(context, TENANT_B, (T0 + 1) as TimestampMs).ok).toBe(true);
  expect(contextRegisterProject(context, SCOPE_A, (T0 + 2) as TimestampMs).ok).toBe(true);
  expect(contextRegisterProject(context, SCOPE_B, (T0 + 3) as TimestampMs).ok).toBe(true);
  // Tenant A writes a canary record onto EVERY surface.
  for (const surface of ISOLATION_SURFACES) {
    const { id, payload } = A_PAYLOADS[surface];
    const written = contextPutRecord(context, surface, { tenant: TENANT_A, project: PROJECT_A, record_id: id, payload: payload as never, asOf: (T0 + 10) as TimestampMs });
    expect(written.ok, `A must write ${surface}`).toBe(true);
  }
  // Tenant B writes its own (fewer) records.
  for (const surface of ['data', 'memory'] as const) {
    const written = contextPutRecord(context, surface, { tenant: TENANT_B, project: PROJECT_B, record_id: `globex-${surface}`, payload: { canary: `GLOBEX-${surface.toUpperCase()}-CANARY-88b` }, asOf: (T0 + 11) as TimestampMs });
    expect(written.ok).toBe(true);
  }
  return context;
}

describe('L12 integration: tenant A is invisible to tenant B on EVERY surface', () => {
  it('listing: B never receives A records on any of the seven surfaces', () => {
    const context = setupTwoTenants();
    for (const surface of ISOLATION_SURFACES) {
      const listed = contextListRecords(context, surface, SCOPE_B);
      expect(listed.every((r) => r.tenant === TENANT_B && r.project === PROJECT_B), `surface ${surface} leaked`).toBe(true);
      expect(listed.some((r) => r.record_id === A_PAYLOADS[surface].id), `surface ${surface} listed A record`).toBe(false);
    }
  });

  it('getting: B receives the TYPED cross_tenant_access error naming both scopes — never the payload', () => {
    const context = setupTwoTenants();
    for (const surface of ISOLATION_SURFACES) {
      const attempt = contextGetRecord(context, surface, SCOPE_B, A_PAYLOADS[surface].id, (T0 + 20) as TimestampMs);
      expect(attempt.ok, `surface ${surface} must refuse B`).toBe(false);
      if (!attempt.ok) {
        expect(attempt.errors[0]!.code, `surface ${surface} must be cross_tenant_access`).toBe('cross_tenant_access');
        expect(attempt.errors[0]!.message).toContain('tenant-acme');
        expect(attempt.errors[0]!.message).toContain('tenant-globex');
        expect(attempt.errors[0]!.message).not.toContain('ACME-');
      }
    }
  });

  it("getting: A own reads still work on every surface (isolation, not denial of service)", () => {
    const context = setupTwoTenants();
    for (const surface of ISOLATION_SURFACES) {
      const own = contextGetRecord(context, surface, SCOPE_A, A_PAYLOADS[surface].id, (T0 + 21) as TimestampMs);
      expect(own.ok, `A must read own ${surface}`).toBe(true);
    }
  });

  it("exports: B's bundle contains none of A's canaries (R42 first pass — the deep proof is export-r42.test.ts)", () => {
    const context = setupTwoTenants();
    const exported = contextExportScope(context, SCOPE_B, (T0 + 30) as TimestampMs);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const serialized = JSON.stringify(exported.value);
    for (const surface of ISOLATION_SURFACES) {
      expect(serialized, `${surface} canary leaked into B's export`).not.toContain(A_PAYLOADS[surface].id);
    }
    expect(serialized).not.toContain('ACME-');
  });

  it('usage: B never counts A acts (and vice versa)', () => {
    const context = setupTwoTenants();
    // A did 7 record writes (the surfaces loop in setup).
    const usageA = contextUsage(context, SCOPE_A);
    const usageB = contextUsage(context, SCOPE_B);
    expect(usageA.ok && usageA.value.recordWrites).toBe(7);
    expect(usageB.ok && usageB.value.recordWrites).toBe(2);
  });

  it('audit trails: B trail never mentions A record ids; every trail chain-verifies', () => {
    const context = setupTwoTenants();
    // B attempts a cross-tenant read (denial audited in B's own trail — ids only).
    contextGetRecord(context, 'memory', SCOPE_B, A_PAYLOADS.memory.id, (T0 + 40) as TimestampMs);
    const trailB = contextAuditTrail(context, SCOPE_B)!;
    const trailA = contextAuditTrail(context, SCOPE_A)!;
    expect(trailB.records.map((r) => r.action)).toContain('cross_tenant_access_denied');
    // The denial record names the ATTEMPTED ref (surface/id) — never A's payload.
    const denial = trailB.records.find((r) => r.action === 'cross_tenant_access_denied')!;
    expect(JSON.stringify(denial)).not.toContain('ACME-');
    // A's trail carries no trace of B's attempt.
    expect(trailA.records.map((r) => r.action)).not.toContain('cross_tenant_access_denied');
    // Whole-context chain verification is clean.
    expect(contextVerifyAllTrails(context)).toBe(0);
  });

  it('workloads: B cannot admit an episode under A descriptor (borrowed descriptor refused)', () => {
    const context = setupTwoTenants();
    const aDescriptor = mintIsolationDescriptor({
      workloadKind: 'episode', egress: 'none', networkAllowlist: [], filesystem: 'scratch',
      credentialAccess: 'none', maxSteps: 50, tenant: TENANT_A, project: PROJECT_A, asOf: T0,
    });
    expect(aDescriptor.ok).toBe(true);
    if (!aDescriptor.ok) return;
    const attempt = contextAdmitEpisode(context, {
      scope: SCOPE_B,
      spec: specB,
      descriptor: aDescriptor.value,
      admittedBy: 'operator:globex',
      admittedAt: (T0 + 50) as TimestampMs,
    });
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.refusal.kind).toBe('cross_tenant_access');
  });

  it('credentials: B cannot resolve A envelope even with the exact version ref', () => {
    const context = setupTwoTenants();
    const envelope = contextRegisterEnvelope(context, {
      tenant: TENANT_A, project: PROJECT_A, venue: null, kind: 'api_key',
      fingerprint: credentialFingerprint('ACME-SECRET-VALUE-do-not-leak'),
      asOf: (T0 + 60) as TimestampMs,
    });
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    expect(contextDepositSecret(context, { envelopeId: envelope.value.envelopeId, version: 1 }, 'ACME-SECRET-VALUE-do-not-leak', (T0 + 61) as TimestampMs).ok).toBe(true);
    const attempt = contextResolveCredential(context, SCOPE_B, { envelopeId: envelope.value.envelopeId, version: 1 }, 'runtime:globex', (T0 + 62) as TimestampMs);
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.refusal.kind).toBe('cross_tenant_access');
  });

  it('the raw registry agrees: an unregistered scope cannot even register A-typed records (door law)', () => {
    const context = createSecurityContext();
    // The raw registry (bypassing the context) enforces registration-first.
    const registry = createTenantIsolationRegistry();
    expect(rawRegisterTenant(registry, TENANT_A, T0).ok).toBe(true);
    const unregisteredWrite = rawPut(registry, 'data', { tenant: TENANT_B, project: PROJECT_B, record_id: 'x', payload: 1, asOf: T0 });
    expect(unregisteredWrite.ok).toBe(false);
    if (!unregisteredWrite.ok) expect(unregisteredWrite.errors[0]!.code).toBe('tenant_missing');
    expect(rawRegisterProject(registry, SCOPE_B, T0).ok).toBe(false); // tenant B not registered
    void context;
  });
});
