/**
 * @tradrl/security-service — isolation-policy + usage + exporter unit
 * tests.
 *
 * Pins: the five admission laws (registered scope, descriptor REQUIRED —
 * the typed isolation_violation, scope match, episode kind, valid spec);
 * the usage ledger (content-addressed events, per-scope counters, hooks);
 * the R42 exporter (scope-pure records, value-free envelopes, the
 * content-address law).
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
  admitEpisode,
  createSecretsVault,
  createTenantIsolationRegistry,
  createUsageLedger,
  exportTenantScope,
  onUsage,
  putScopedRecord,
  recordUsage,
  registerCredentialEnvelope,
  registerProject,
  registerTenant,
  usageFor,
  usageEventsFor,
  validateExportBundle,
  type UsageEvent,
} from './index';

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT = 'tenant-policy' as TenantId;
const PROJECT = 'project-policy' as ProjectId;
const SCOPE: Scope = { tenant: TENANT, project: PROJECT };

function registeredRegistry() {
  const registry = createTenantIsolationRegistry();
  expect(registerTenant(registry, TENANT, T0).ok).toBe(true);
  expect(registerProject(registry, SCOPE, (T0 + 1) as TimestampMs).ok).toBe(true);
  return registry;
}

function specFixture(): EnvironmentSpec {
  return {
    profile: {
      environment_id: 'env-policy' as EnvironmentSpec['profile']['environment_id'],
      fidelity: 'reactive_replay',
      clock: { now: T0, asOf: (T0 + 3_600_000) as TimestampMs, playbackSpeed: 1, paused: false, fidelity: 'reactive_replay', informationPolicy: 'point-in-time' },
      seed: 'seed-policy' as EnvironmentSpec['profile']['seed'],
      venue_scope: ['binance'] as unknown as EnvironmentSpec['profile']['venue_scope'],
      instrument_scope: ['BTC-USDT'] as unknown as EnvironmentSpec['profile']['instrument_scope'],
      latency_policy: null,
      fee_policy: null,
    },
    world: { world_id: 'world-policy' as EnvironmentSpec['world']['world_id'], kind: 'replay' },
    information_policy: 'point-in-time',
  };
}

function descriptorFixture() {
  const result = mintIsolationDescriptor({
    workloadKind: 'episode',
    egress: 'none',
    networkAllowlist: [],
    filesystem: 'scratch',
    credentialAccess: 'envelope_refs_only',
    maxSteps: 1_000,
    tenant: TENANT,
    project: PROJECT,
    asOf: T0,
  });
  if (!result.ok) throw new Error('fixture');
  return result.value;
}

describe('the five admission laws', () => {
  it('a registered scope + valid descriptor + valid spec admits (record binds the derived episode id)', () => {
    const registry = registeredRegistry();
    const admission = admitEpisode(registry, { scope: SCOPE, spec: specFixture(), descriptor: descriptorFixture(), admittedBy: 'operator:ada', admittedAt: (T0 + 2) as TimestampMs });
    expect(admission.ok).toBe(true);
    if (admission.ok) {
      expect(admission.admission.episodeId).toMatch(/^ep-[0-9a-f]{8}$/);
      expect(admission.admission.admissionId).toMatch(/^eadm:[0-9a-f]{8}$/);
      expect(admission.admission.tenant).toBe(TENANT);
    }
  });

  it('an UNREGISTERED scope is tenant_missing (even with a descriptor)', () => {
    const registry = createTenantIsolationRegistry();
    const result = admitEpisode(registry, { scope: SCOPE, spec: specFixture(), descriptor: descriptorFixture(), admittedBy: 'x', admittedAt: T0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.kind).toBe('tenant_missing');
  });

  it("NO descriptor is the typed isolation_violation (the charter named error)", () => {
    const registry = registeredRegistry();
    const result = admitEpisode(registry, { scope: SCOPE, spec: specFixture(), descriptor: null, admittedBy: 'operator:ada', admittedAt: (T0 + 2) as TimestampMs });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal.kind).toBe('isolation_violation');
      expect(result.errors[0]!.code).toBe('isolation_violation');
      expect(result.errors[0]!.message).toContain('require isolation');
    }
  });

  it('a BORROWED descriptor (another scope) is cross_tenant_access', () => {
    const registry = registeredRegistry();
    const foreign = mintIsolationDescriptor({
      workloadKind: 'episode', egress: 'none', networkAllowlist: [], filesystem: 'none', credentialAccess: 'none', maxSteps: 10,
      tenant: 'tenant-other' as TenantId, project: PROJECT, asOf: T0,
    });
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;
    const result = admitEpisode(registry, { scope: SCOPE, spec: specFixture(), descriptor: foreign.value, admittedBy: 'x', admittedAt: T0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.kind).toBe('cross_tenant_access');
  });

  it('a research-kind descriptor does not admit episodes; a malformed spec is invalid_type', () => {
    const registry = registeredRegistry();
    const research = mintIsolationDescriptor({
      workloadKind: 'research', egress: 'none', networkAllowlist: [], filesystem: 'none', credentialAccess: 'none', maxSteps: null,
      tenant: TENANT, project: PROJECT, asOf: T0,
    });
    expect(research.ok).toBe(true);
    if (research.ok) {
      const result = admitEpisode(registry, { scope: SCOPE, spec: specFixture(), descriptor: research.value, admittedBy: 'x', admittedAt: T0 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.refusal.kind).toBe('isolation_violation');
    }
    const brokenSpec = { ...specFixture(), information_policy: 'leaky' } as unknown as EnvironmentSpec;
    const result2 = admitEpisode(registry, { scope: SCOPE, spec: brokenSpec, descriptor: descriptorFixture(), admittedBy: 'x', admittedAt: T0 });
    expect(result2.ok).toBe(false);
    if (!result2.ok) expect(result2.refusal.kind).toBe('invalid_type');
  });
});

describe('the usage ledger', () => {
  it('records scoped, content-addressed events and keeps per-scope counters', () => {
    const ledger = createUsageLedger();
    const a1 = recordUsage(ledger, SCOPE, 'credential_resolution', 1, 'cred:1@1', T0);
    const a2 = recordUsage(ledger, SCOPE, 'episode_admitted', 1, 'ep-1', (T0 + 1) as TimestampMs);
    expect(a1.ok && a2.ok).toBe(true);
    const summary = usageFor(ledger, SCOPE);
    expect(summary.ok).toBe(true);
    if (summary.ok) {
      expect(summary.value.credentialResolutions).toBe(1);
      expect(summary.value.episodesAdmitted).toBe(1);
      expect(summary.value.eventCount).toBe(2);
    }
    // Determinism: the same act stream produces the same ids.
    const ledger2 = createUsageLedger();
    recordUsage(ledger2, SCOPE, 'credential_resolution', 1, 'cred:1@1', T0);
    recordUsage(ledger2, SCOPE, 'episode_admitted', 1, 'ep-1', (T0 + 1) as TimestampMs);
    expect(usageEventsFor(ledger2, SCOPE).map((e) => e.event_id)).toEqual(usageEventsFor(ledger, SCOPE).map((e) => e.event_id));
  });

  it('fires registered hooks with the typed events', () => {
    const ledger = createUsageLedger();
    const seen: UsageEvent[] = [];
    onUsage(ledger, (event) => seen.push(event));
    recordUsage(ledger, SCOPE, 'export', 1, 'xexp:1', T0);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe('export');
  });

  it("another scope counters are unreachable (empty for a foreign scope)", () => {
    const ledger = createUsageLedger();
    recordUsage(ledger, SCOPE, 'export', 1, 'xexp:1', T0);
    const foreign: Scope = { tenant: 'tenant-other' as TenantId, project: PROJECT };
    const summary = usageFor(ledger, foreign);
    expect(summary.ok).toBe(true);
    if (summary.ok) expect(summary.value.eventCount).toBe(0);
  });
});

describe('the R42 exporter', () => {
  it("exports ONLY the scope records and value-free envelopes; the bundle is content-addressed and self-validates", () => {
    const registry = registeredRegistry();
    const vault = createSecretsVault();
    const ledger = createUsageLedger();
    // Tenant's own data.
    expect(putScopedRecord(registry, 'data', { tenant: TENANT, project: PROJECT, record_id: 'a-data', payload: { v: 1 }, asOf: T0 }).ok).toBe(true);
    expect(putScopedRecord(registry, 'memory', { tenant: TENANT, project: PROJECT, record_id: 'a-mem', payload: { m: 'note' }, asOf: (T0 + 1) as TimestampMs }).ok).toBe(true);
    // Another tenant's data in the SAME registry.
    const OTHER: Scope = { tenant: 'tenant-other' as TenantId, project: PROJECT };
    expect(registerTenant(registry, OTHER.tenant, T0).ok).toBe(true);
    expect(registerProject(registry, OTHER, T0).ok).toBe(true);
    expect(putScopedRecord(registry, 'data', { tenant: OTHER.tenant, project: PROJECT, record_id: 'b-data', payload: { secretOfB: 'customer-b-fact' }, asOf: (T0 + 2) as TimestampMs }).ok).toBe(true);
    // The tenant's envelope (value-free in the bundle).
    const envelope = registerCredentialEnvelope(vault, {
      tenant: TENANT, project: PROJECT, venue: null, kind: 'api_key',
      fingerprint: credentialFingerprint('EXPORT-NEVER-CARRIES-VALUES'), asOf: T0,
    });
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    recordUsage(ledger, SCOPE, 'record_write', 1, 'data/a-data', T0);

    const exported = exportTenantScope(registry, vault, ledger, SCOPE, (T0 + 10) as TimestampMs);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const bundle = exported.value;
    expect(bundle.bundleId).toMatch(/^xexp:[0-9a-f]{8}$/);
    // R42: the other tenant's record is ABSENT.
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('customer-b-fact');
    expect(serialized).not.toContain('b-data');
    // The envelope is present as a reference, the value never.
    expect(serialized).toContain(envelope.value.envelopeId);
    expect(serialized).not.toContain('EXPORT-NEVER-CARRIES-VALUES');
    // Self-validation passes; a forged bundle id fails.
    expect(validateExportBundle(bundle, SCOPE).ok).toBe(true);
    const forged = validateExportBundle({ ...bundle, bundleId: 'xexp:00000000' as never }, SCOPE);
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.errors[0]!.code).toBe('invalid_field');
  });

  it('a smuggled foreign record inside a bundle is the typed export_scope_violation', () => {
    const registry = registeredRegistry();
    const vault = createSecretsVault();
    const ledger = createUsageLedger();
    const exported = exportTenantScope(registry, vault, ledger, SCOPE, T0);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const smuggled = JSON.parse(JSON.stringify(exported.value)) as { records: { surface: string; records: unknown[] }[] };
    smuggled.records[0]!.records.push({ record_id: 'stolen', surface: 'data', payload: { x: 1 }, asOf: T0, tenant: 'tenant-other', project: PROJECT });
    const result = validateExportBundle(smuggled as never, SCOPE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('export_scope_violation');
  });

  it('an unregistered scope cannot export (tenant_missing)', () => {
    const registry = createTenantIsolationRegistry();
    const result = exportTenantScope(registry, createSecretsVault(), createUsageLedger(), SCOPE, T0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('tenant_missing');
  });
});
