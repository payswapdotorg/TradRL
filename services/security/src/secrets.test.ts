/**
 * @tradrl/security-service — secrets vault unit tests.
 *
 * Pins: the deposit law (fingerprint verification, one deposit per
 * version); the resolution laws (L12 cross-tenant typed error, unknown,
 * retired, revoked, not-deposited); rotation (id stable, predecessor
 * retired, new value resolves); revocation tombstone; the VALUE-FREE
 * property of every view (envelopes/chains) — the deep byte-scan lives
 * in tests/security/secrets.test.ts.
 */
import { describe, expect, it } from 'vitest';

import { credentialFingerprint, type ProjectId, type Scope, type TenantId, type TimestampMs, type VenueId } from '../../../packages/security/src/index';
import {
  createSecretsVault,
  depositSecretValue,
  isDeposited,
  registerCredentialEnvelope,
  resolveCredential,
  revokeCredential,
  rotateSecret,
  vaultEnvelopeChain,
  vaultEnvelopes,
} from './index';

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT_A = 'tenant-vault-a' as TenantId;
const TENANT_B = 'tenant-vault-b' as TenantId;
const PROJECT = 'project-vault' as ProjectId;
const VENUE = 'binance' as VenueId;
const SCOPE_A: Scope = { tenant: TENANT_A, project: PROJECT };
const SCOPE_B: Scope = { tenant: TENANT_B, project: PROJECT };
const SECRET = 'AKIA-VAULT-CANARY-9f8e7d6c';

function vaultWithSecret() {
  const vault = createSecretsVault();
  const envelope = registerCredentialEnvelope(vault, {
    tenant: TENANT_A,
    project: PROJECT,
    venue: VENUE,
    kind: 'api_key',
    fingerprint: credentialFingerprint(SECRET),
    asOf: T0,
  });
  expect(envelope.ok).toBe(true);
  if (!envelope.ok) throw new Error('fixture');
  const deposit = depositSecretValue(vault, { envelopeId: envelope.value.envelopeId, version: 1 }, SECRET, (T0 + 1) as TimestampMs);
  expect(deposit.ok).toBe(true);
  return { vault, envelopeId: envelope.value.envelopeId };
}

describe('registration and deposits', () => {
  it('registers a v1 envelope and deposits the value (receipt carries NO value)', () => {
    const { vault, envelopeId } = vaultWithSecret();
    expect(vaultEnvelopes(vault)).toHaveLength(1);
    expect(vaultEnvelopes(vault)[0]!.envelopeId).toBe(envelopeId);
    expect(isDeposited(vault, { envelopeId, version: 1 })).toBe(true);
    expect(JSON.stringify(vaultEnvelopes(vault))).not.toContain(SECRET);
  });

  it('a wrong value is the typed secret_fingerprint_mismatch', () => {
    const vault = createSecretsVault();
    const envelope = registerCredentialEnvelope(vault, {
      tenant: TENANT_A, project: PROJECT, venue: VENUE, kind: 'api_key',
      fingerprint: credentialFingerprint('RIGHT-VALUE'), asOf: T0,
    });
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const wrong = depositSecretValue(vault, { envelopeId: envelope.value.envelopeId, version: 1 }, 'WRONG-VALUE', (T0 + 1) as TimestampMs);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.errors[0]!.code).toBe('secret_fingerprint_mismatch');
  });

  it('a second deposit of the same version is refused (one deposit per version)', () => {
    const { vault, envelopeId } = vaultWithSecret();
    const again = depositSecretValue(vault, { envelopeId, version: 1 }, SECRET, (T0 + 2) as TimestampMs);
    expect(again.ok).toBe(false);
  });

  it('a deposit against an unknown envelope is unknown_credential', () => {
    const vault = createSecretsVault();
    const result = depositSecretValue(vault, { envelopeId: 'cred:00000000' as never, version: 1 }, 'x', T0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('unknown_credential');
  });
});

describe('resolution (the runtime boundary exit)', () => {
  it('the owning scope resolves the active latest version and receives the value + a value-free receipt', () => {
    const { vault, envelopeId } = vaultWithSecret();
    const resolution = resolveCredential(vault, SCOPE_A, { envelopeId, version: 1 }, 'runtime:research-1', (T0 + 5) as TimestampMs);
    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.value).toBe(SECRET);
      expect(resolution.receipt.runtime).toBe('runtime:research-1');
      expect(JSON.stringify(resolution.receipt)).not.toContain(SECRET);
    }
  });

  it('another scope is the typed cross_tenant_access (L12)', () => {
    const { vault, envelopeId } = vaultWithSecret();
    const foreign = resolveCredential(vault, SCOPE_B, { envelopeId, version: 1 }, 'runtime:evil', (T0 + 5) as TimestampMs);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) {
      expect(foreign.refusal.kind).toBe('cross_tenant_access');
      expect(foreign.errors[0]!.code).toBe('cross_tenant_access');
    }
  });

  it('an undeposited envelope is secret_not_deposited', () => {
    const vault = createSecretsVault();
    const envelope = registerCredentialEnvelope(vault, {
      tenant: TENANT_A, project: PROJECT, venue: VENUE, kind: 'api_key',
      fingerprint: credentialFingerprint('NEVER-DEPOSITED'), asOf: T0,
    });
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const result = resolveCredential(vault, SCOPE_A, { envelopeId: envelope.value.envelopeId, version: 1 }, 'runtime:x', T0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.kind).toBe('secret_not_deposited');
  });
});

describe('rotation and revocation', () => {
  it('rotation keeps the id stable; the old version retires; the new value resolves', () => {
    const { vault, envelopeId } = vaultWithSecret();
    const rotation = rotateSecret(vault, envelopeId, 'AKIA-ROTATED-VALUE-2b1a', (T0 + 10) as TimestampMs);
    expect(rotation.ok).toBe(true);
    if (!rotation.ok) return;
    expect(rotation.value.envelope.envelopeId).toBe(envelopeId);
    expect(rotation.value.envelope.version).toBe(2);
    // Old version: retired.
    const old = resolveCredential(vault, SCOPE_A, { envelopeId, version: 1 }, 'runtime:x', (T0 + 11) as TimestampMs);
    expect(old.ok).toBe(false);
    if (!old.ok) expect(old.refusal.kind).toBe('credential_retired');
    // New version: resolves to the new value.
    const fresh = resolveCredential(vault, SCOPE_A, { envelopeId, version: 2 }, 'runtime:x', (T0 + 12) as TimestampMs);
    expect(fresh.ok && fresh.value).toBe('AKIA-ROTATED-VALUE-2b1a');
    // The chain is append-only and complete.
    expect(vaultEnvelopeChain(vault, envelopeId).map((e) => e.version)).toEqual([1, 2]);
  });

  it('revocation is a tombstone: every version dies, there is no un-revocation', () => {
    const { vault, envelopeId } = vaultWithSecret();
    const revoke = revokeCredential(vault, envelopeId, (T0 + 20) as TimestampMs);
    expect(revoke.ok).toBe(true);
    if (!revoke.ok) return;
    expect(revoke.value.status).toBe('revoked');
    expect(revoke.value.version).toBe(2);
    const dead = resolveCredential(vault, SCOPE_A, { envelopeId, version: 1 }, 'runtime:x', (T0 + 21) as TimestampMs);
    expect(dead.ok).toBe(false);
    if (!dead.ok) expect(dead.refusal.kind).toBe('credential_revoked');
    // Rotating a revoked envelope is impossible.
    const rotate = rotateSecret(vault, envelopeId, 'zombie-value', (T0 + 22) as TimestampMs);
    expect(rotate.ok).toBe(false);
    if (!rotate.ok) expect(rotate.errors[0]!.code).toBe('credential_revoked');
    // Double revocation is refused (append-only tombstone).
    const again = revokeCredential(vault, envelopeId, (T0 + 23) as TimestampMs);
    expect(again.ok).toBe(false);
  });
});

describe('the vault views (value-free by construction)', () => {
  it('JSON.stringify over the vault object and its views never contains the secret', () => {
    const { vault, envelopeId } = vaultWithSecret();
    expect(JSON.stringify(vault)).not.toContain(SECRET);
    expect(JSON.stringify(vaultEnvelopes(vault))).not.toContain(SECRET);
    expect(JSON.stringify(vaultEnvelopeChain(vault, envelopeId))).not.toContain(SECRET);
  });
});
