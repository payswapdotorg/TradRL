/**
 * T044 INTEGRATION — the secrets boundary: a credential envelope NEVER
 * materializes as plaintext in ANY serialized record.
 *
 * THE LAW (spec/SECURITY.md Secrets: "Never commit provider credentials.
 * Inject them through secure runtime boundaries."; L12: credentials are
 * isolated; the Work Order: "a credential envelope never materializes
 * as plaintext in any serialized record").
 *
 * THE METHOD: plant a high-entropy canary secret; drive the FULL
 * lifecycle (register envelope -> deposit -> resolve -> rotate -> revoke
 * -> export -> audit); then BYTE-SCAN every serialized surface the
 * platform can produce — the vault object itself, every view (envelopes,
 * chains), the registry snapshot, every audit trail, the receipts, the
 * usage events, the export bundle, the whole context snapshot, the
 * ERROR MESSAGES of every refusal, and the resolution envelope — for
 * the canary. The value may exist ONLY in the resolving caller's local
 * variable (the runtime boundary handoff).
 *
 * Also pins: the structural laws (a record CARRYING a value is
 * inexpressible — the typed credential_value_present); determinism of
 * the whole lifecycle.
 */
import { describe, expect, it } from 'vitest';

import {
  credentialFingerprint,
  credentialValueViolations,
  mintIsolationDescriptor,
  redactCredentialValues,
  scrubForLog,
  type ProjectId,
  type Scope,
  type TenantId,
  type TimestampMs,
} from '../../packages/security/src/index';
import {
  contextAdmitEpisode,
  contextAuditTrail,
  contextDepositSecret,
  contextEnvelopes,
  contextExportScope,
  contextGetRecord,
  contextPutRecord,
  contextRegisterEnvelope,
  contextRegisterProject,
  contextRegisterTenant,
  contextResolveCredential,
  contextRevokeCredential,
  contextRotateSecret,
  contextSnapshot,
  contextUsage,
  contextVerifyAllTrails,
  createSecurityContext,
  depositSecretValue,
  resolveCredential,
  createSecretsVault,
  registerCredentialEnvelope,
  usageEventsFor,
  vaultEnvelopeChain,
  vaultEnvelopes,
} from '../../services/security/src/index';

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT = 'tenant-secrets-integration' as TenantId;
const PROJECT = 'project-secrets-integration' as ProjectId;
const SCOPE: Scope = { tenant: TENANT, project: PROJECT };
const SECRET_V1 = 'AKIA-CANARY-v1-4f3e2d1c0b9a8f7e6d5c4b3a2a1a0a';
const SECRET_V2 = 'AKIA-CANARY-v2-9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d';

describe('the full lifecycle under a canary', () => {
  it('the value exists ONLY in the resolving caller local — every serialized surface is canary-free', () => {
    const context = createSecurityContext();
    expect(contextRegisterTenant(context, TENANT, T0).ok).toBe(true);
    expect(contextRegisterProject(context, SCOPE, (T0 + 1) as TimestampMs).ok).toBe(true);

    // Register + deposit the canary.
    const envelope = contextRegisterEnvelope(context, {
      tenant: TENANT, project: PROJECT, venue: 'binance' as never, kind: 'api_key',
      fingerprint: credentialFingerprint(SECRET_V1), asOf: (T0 + 10) as TimestampMs,
    });
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const envelopeId = envelope.value.envelopeId;
    expect(contextDepositSecret(context, { envelopeId, version: 1 }, SECRET_V1, (T0 + 11) as TimestampMs).ok).toBe(true);

    // Resolve (the runtime boundary handoff — the ONLY place the value lives).
    const resolution = contextResolveCredential(context, SCOPE, { envelopeId, version: 1 }, 'runtime:research-1', (T0 + 12) as TimestampMs);
    expect(resolution.ok && resolution.value).toBe(SECRET_V1);

    // Rotate and resolve the new version.
    expect(contextRotateSecret(context, envelopeId, SECRET_V2, (T0 + 20) as TimestampMs).ok).toBe(true);
    const resolution2 = contextResolveCredential(context, SCOPE, { envelopeId, version: 2 }, 'runtime:research-1', (T0 + 21) as TimestampMs);
    expect(resolution2.ok && resolution2.value).toBe(SECRET_V2);
    // The old version is retired — its refusal message carries NO value.
    const old = contextResolveCredential(context, SCOPE, { envelopeId, version: 1 }, 'runtime:research-1', (T0 + 22) as TimestampMs);
    expect(old.ok).toBe(false);
    if (!old.ok) expect(JSON.stringify(old.errors)).not.toContain('AKIA-CANARY');

    // Revoke; the tombstone is audited; resolution dies without leaking.
    expect(contextRevokeCredential(context, envelopeId, (T0 + 30) as TimestampMs).ok).toBe(true);
    const dead = contextResolveCredential(context, SCOPE, { envelopeId, version: 2 }, 'runtime:research-1', (T0 + 31) as TimestampMs);
    expect(dead.ok).toBe(false);
    if (!dead.ok) expect(JSON.stringify(dead.errors)).not.toContain('AKIA-CANARY');

    // An export of the scope (envelopes included, values never).
    const exported = contextExportScope(context, SCOPE, (T0 + 40) as TimestampMs);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    // THE BYTE-SCAN: every surface the platform can produce.
    const surfaces: readonly { name: string; serialized: string }[] = [
      { name: 'vault-object', serialized: JSON.stringify(context) },
      { name: 'context-snapshot', serialized: JSON.stringify(contextSnapshot(context)) },
      { name: 'envelopes-view', serialized: JSON.stringify(contextEnvelopes(context)) },
      { name: 'audit-trail', serialized: JSON.stringify(contextAuditTrail(context, SCOPE)) },
      { name: 'usage-summary', serialized: JSON.stringify(contextUsage(context, SCOPE)) },
      { name: 'export-bundle', serialized: JSON.stringify(exported.value) },
      { name: 'resolution-receipt-v2', serialized: JSON.stringify(resolution2.ok ? resolution2.receipt : null) },
      { name: 'resolution-envelope-v2', serialized: JSON.stringify(resolution2.ok ? resolution2.envelope : null) },
      { name: 'refusal-v1', serialized: JSON.stringify(old.ok ? null : old.errors) },
      { name: 'refusal-dead', serialized: JSON.stringify(dead.ok ? null : dead.errors) },
    ];
    expect(surfaces).toHaveLength(10);
    for (const surface of surfaces) {
      expect(surface.serialized, `${surface.name} leaked the canary`).not.toContain(SECRET_V1);
      expect(surface.serialized, `${surface.name} leaked the rotated canary`).not.toContain(SECRET_V2);
      expect(surface.serialized, `${surface.name} leaked any canary fragment`).not.toContain('AKIA-CANARY');
    }
    // The trails still chain-verify after the whole lifecycle.
    expect(contextVerifyAllTrails(context)).toBe(0);
  });

  it('determinism: the identical lifecycle twice produces identical envelope ids, audit chains and bundles', () => {
    const run = (): { envelopeId: string; trail: string; bundleId: string } => {
      const context = createSecurityContext();
      contextRegisterTenant(context, TENANT, T0);
      contextRegisterProject(context, SCOPE, (T0 + 1) as TimestampMs);
      const envelope = contextRegisterEnvelope(context, {
        tenant: TENANT, project: PROJECT, venue: null, kind: 'api_key',
        fingerprint: credentialFingerprint(SECRET_V1), asOf: (T0 + 10) as TimestampMs,
      });
      if (!envelope.ok) throw new Error('fixture');
      contextDepositSecret(context, { envelopeId: envelope.value.envelopeId, version: 1 }, SECRET_V1, (T0 + 11) as TimestampMs);
      contextResolveCredential(context, SCOPE, { envelopeId: envelope.value.envelopeId, version: 1 }, 'runtime:det', (T0 + 12) as TimestampMs);
      const exported = contextExportScope(context, SCOPE, (T0 + 13) as TimestampMs);
      if (!exported.ok) throw new Error('fixture');
      const trail = contextAuditTrail(context, SCOPE)!;
      return {
        envelopeId: envelope.value.envelopeId,
        trail: JSON.stringify(trail.records.map((r) => [r.auditId, r.chainHead])),
        bundleId: exported.value.bundleId,
      };
    };
    const first = run();
    const second = run();
    expect(second.envelopeId).toBe(first.envelopeId);
    expect(second.trail).toBe(first.trail);
    expect(second.bundleId).toBe(first.bundleId);
  });
});

describe('the structural laws (a record carrying a value is inexpressible)', () => {
  it('every write path refuses planted values with the typed credential_value_present', () => {
    const context = createSecurityContext();
    contextRegisterTenant(context, TENANT, T0);
    contextRegisterProject(context, SCOPE, (T0 + 1) as TimestampMs);
    // 1. A scoped record carrying a value.
    const write = contextPutRecord(context, 'data', { tenant: TENANT, project: PROJECT, record_id: 'x', payload: { apiKey: SECRET_V1 }, asOf: (T0 + 2) as TimestampMs });
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.errors[0]!.code).toBe('credential_value_present');
    // 2. An envelope declaration carrying a value.
    const envelope = contextRegisterEnvelope(context, {
      tenant: TENANT, project: PROJECT, venue: null, kind: 'api_key',
      fingerprint: credentialFingerprint(SECRET_V1), asOf: (T0 + 3) as TimestampMs,
    });
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    // 3. A payload smuggling under ANY normalization.
    for (const key of ['apiKey', 'api_key', 'API-KEY', 'privateKey', 'passphrase', 'seedPhrase']) {
      const smuggled = contextPutRecord(context, 'artifacts', { tenant: TENANT, project: PROJECT, record_id: `s-${key}`, payload: { [key]: 'x' } as never, asOf: (T0 + 4) as TimestampMs });
      expect(smuggled.ok, `key ${key} must be refused`).toBe(false);
      if (!smuggled.ok) expect(smuggled.errors[0]!.code).toBe('credential_value_present');
    }
    // 4. The registry read of the clean envelope record is value-free.
    const stored = contextGetRecord(context, 'credentials', SCOPE, `envelope:${envelope.value.envelopeId}`, (T0 + 5) as TimestampMs);
    expect(stored.ok).toBe(true);
    if (stored.ok) expect(JSON.stringify(stored.value)).not.toContain('AKIA-CANARY');
  });

  it('the raw vault: JSON.stringify and property walks cannot reach the value; only resolveCredential can', () => {
    const vault = createSecretsVault();
    const envelope = registerCredentialEnvelope(vault, {
      tenant: TENANT, project: PROJECT, venue: null, kind: 'api_key',
      fingerprint: credentialFingerprint(SECRET_V1), asOf: T0,
    });
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    expect(depositSecretValue(vault, { envelopeId: envelope.value.envelopeId, version: 1 }, SECRET_V1, (T0 + 1) as TimestampMs).ok).toBe(true);
    // Serialization attempts.
    expect(JSON.stringify(vault)).not.toContain('AKIA-CANARY');
    expect(JSON.stringify(vaultEnvelopes(vault))).not.toContain('AKIA-CANARY');
    expect(Object.keys(vault)).toEqual(['kind']);
    // The resolution works (the boundary).
    const resolution = resolveCredential(vault, SCOPE, { envelopeId: envelope.value.envelopeId, version: 1 }, 'rt', (T0 + 2) as TimestampMs);
    expect(resolution.ok && resolution.value).toBe(SECRET_V1);
  });
});

describe('the scrubbing helpers on realistic polluted trees', () => {
  it('the trip wire flags, the scrub cleans, and the clean tree passes the wire', () => {
    const polluted = {
      venue: 'binance',
      apiKey: SECRET_V1,
      nested: { operator_note: 'from support', password: 'hunter2' },
      audit: { detail: 'resolved for runtime' },
    };
    expect(credentialValueViolations(polluted)).toEqual(['apiKey', 'nested.password']);
    const scrubbed = scrubForLog(polluted);
    expect(scrubbed.verifiedClean).toBe(true);
    expect(JSON.stringify(scrubbed.tree)).not.toContain('AKIA-CANARY');
    expect(JSON.stringify(scrubbed.tree)).not.toContain('hunter2');
    // The redactor report matches the wire paths exactly.
    expect(redactCredentialValues(polluted).report.redactedPaths).toEqual(['apiKey', 'nested.password']);
  });
});

describe('the workload boundary never sees values (credentialAccess floor)', () => {
  it('an admitted episode with envelope_refs_only still resolves through the CONTEXT, not the workload record', () => {
    const context = createSecurityContext();
    contextRegisterTenant(context, TENANT, T0);
    contextRegisterProject(context, SCOPE, (T0 + 1) as TimestampMs);
    const descriptor = mintIsolationDescriptor({
      workloadKind: 'episode', egress: 'none', networkAllowlist: [], filesystem: 'scratch',
      credentialAccess: 'envelope_refs_only', maxSteps: 10, tenant: TENANT, project: PROJECT, asOf: T0,
    });
    expect(descriptor.ok).toBe(true);
    if (!descriptor.ok) return;
    const admitted = contextAdmitEpisode(context, {
      scope: SCOPE,
      spec: {
        profile: {
          environment_id: 'env-sec' as never, fidelity: 'generative',
          clock: { now: T0, asOf: (T0 + 10_000) as TimestampMs, playbackSpeed: 1, paused: false, fidelity: 'generative', informationPolicy: 'point-in-time' },
          seed: 'seed-sec' as never, venue_scope: [] as never, instrument_scope: [] as never, latency_policy: null, fee_policy: null,
        },
        world: { world_id: 'world-sec' as never, kind: 'stub' },
        information_policy: 'point-in-time',
      },
      descriptor: descriptor.value,
      admittedBy: 'operator:sec',
      admittedAt: (T0 + 2) as TimestampMs,
    });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    // The admission record is value-free (it carries only the descriptor echo).
    expect(JSON.stringify(admitted.admission)).not.toContain('AKIA-CANARY');
    expect(admitted.admission.constraints.credentialAccess).toBe('envelope_refs_only');
  });
});
