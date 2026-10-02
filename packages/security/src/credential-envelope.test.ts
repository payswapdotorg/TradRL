/**
 * @tradrl/security — the credential-envelope tests.
 *
 * Pins: the opacity law (a value under any credential-shaped key kills
 * the record with the typed `credential_value_present`, reported FIRST);
 * the possession-fingerprint law; the version-chain laws (contiguous
 * supersedes, same id, content addressing for v1); rotation and
 * revocation tombstones; the derived resolution verdict; the injection
 * receipt (value-free); determinism (identical declarations produce
 * byte-identical envelopes).
 */
import { describe, expect, it } from 'vitest';

import {
  canonicalEnvelopeJson,
  credentialFingerprint,
  credentialInjectionReceipt,
  credentialStatus,
  envelopeContentTree,
  isCredentialEnvelope,
  isCredentialInjectionReceipt,
  mintCredentialEnvelope,
  reviseCredentialEnvelope,
  validateCredentialEnvelope,
  type CredentialEnvelope,
  type ProjectId,
  type TenantId,
  type TimestampMs,
  type VenueId,
} from './index';

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT = 'tenant-secrets' as TenantId;
const PROJECT = 'project-secrets' as ProjectId;
const VENUE = 'binance' as VenueId;

type EnvelopeDeclaration = Omit<CredentialEnvelope, 'envelopeId' | 'version' | 'supersedes'>;

function declaration(overrides: Partial<EnvelopeDeclaration> = {}): EnvelopeDeclaration {
  return {
    tenant: TENANT,
    project: PROJECT,
    venue: VENUE,
    kind: 'api_key',
    fingerprint: credentialFingerprint('CANARY-SECRET-VALUE'),
    status: 'active',
    asOf: T0,
    ...overrides,
  };
}

describe('the possession fingerprint', () => {
  it('is deterministic and domain-separated', () => {
    expect(credentialFingerprint('hunter2')).toBe(credentialFingerprint('hunter2'));
    expect(credentialFingerprint('hunter2')).not.toBe(credentialFingerprint('hunter3'));
    expect(credentialFingerprint('hunter2')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('the opacity law (the trip wire over the whole record)', () => {
  it('minting with a credential-shaped key ANYWHERE is the typed credential_value_present', () => {
    for (const key of ['secret', 'apiKey', 'api_key', 'API-KEY', 'privateKey', 'password', 'passphrase', 'token', 'mnemonic', 'seedPhrase', 'credential']) {
      const result = mintCredentialEnvelope(declaration({
        ...({ [key]: 'super-secret-material' } as unknown as Partial<EnvelopeDeclaration>),
      }));
      expect(result.ok, `key ${key} must be refused`).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]!.code).toBe('credential_value_present');
        expect(result.errors[0]!.message).toContain(key);
      }
    }
  });

  it('the violation is reported FIRST (before any other field error)', () => {
    const result = validateCredentialEnvelope({ envelopeId: 'cred:deadbeef', ...declaration({ tenant: '' as TenantId }), apiKey: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('credential_value_present');
  });

  it('nested and array-smuggled values are caught with deterministic dotted paths', () => {
    const smuggled = {
      envelopeId: 'cred:00000001',
      version: 1,
      supersedes: null,
      tenant: TENANT,
      project: PROJECT,
      venue: null,
      kind: 'api_key',
      fingerprint: '0123abcd',
      status: 'active',
      asOf: T0,
      meta: { notes: [{ apiKey: 'nested-secret' }] },
    };
    const result = validateCredentialEnvelope(smuggled);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.code).toBe('credential_value_present');
      expect(result.errors[0]!.message).toContain('meta.notes[0].apiKey');
    }
    expect(isCredentialEnvelope(smuggled)).toBe(false);
  });
});

describe('minting and the version chain', () => {
  it('mints a content-addressed v1 envelope (deterministic: identical declarations, identical bytes)', () => {
    const a = mintCredentialEnvelope(declaration());
    const b = mintCredentialEnvelope(declaration());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.envelopeId).toBe(b.value.envelopeId);
      expect(canonicalEnvelopeJson(a.value)).toBe(canonicalEnvelopeJson(b.value));
      expect(a.value.envelopeId.startsWith('cred:')).toBe(true);
      expect(a.value.version).toBe(1);
      expect(a.value.supersedes).toBeNull();
      expect(Object.isFrozen(a.value)).toBe(true);
    }
  });

  it('a forged v1 id fails the content-address law', () => {
    const minted = mintCredentialEnvelope(declaration());
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    const forged = validateCredentialEnvelope({ ...minted.value, envelopeId: 'cred:00000000' as CredentialEnvelope['envelopeId'] });
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.errors[0]!.code).toBe('invalid_field');
  });

  it('rotation keeps the id STABLE and carries the contiguous supersedes chain', () => {
    const v1 = mintCredentialEnvelope(declaration());
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    const v2 = reviseCredentialEnvelope(v1.value, { status: 'active', asOf: (T0 + 1) as TimestampMs, fingerprint: credentialFingerprint('ROTATED-VALUE') });
    expect(v2.ok).toBe(true);
    if (!v2.ok) return;
    expect(v2.value.envelopeId).toBe(v1.value.envelopeId);
    expect(v2.value.version).toBe(2);
    expect(v2.value.supersedes).toEqual({ envelopeId: v1.value.envelopeId, version: 1 });
    expect(v2.value.fingerprint).toBe(credentialFingerprint('ROTATED-VALUE'));

    const v3 = reviseCredentialEnvelope(v2.value, { status: 'active', asOf: (T0 + 2) as TimestampMs });
    expect(v3.ok).toBe(true);
    if (v3.ok) expect(v3.value.supersedes).toEqual({ envelopeId: v2.value.envelopeId, version: 2 });
  });

  it('a non-contiguous supersedes chain is refused', () => {
    const v1 = mintCredentialEnvelope(declaration());
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    const skipped = validateCredentialEnvelope({
      ...v1.value,
      version: 3,
      supersedes: { envelopeId: v1.value.envelopeId, version: 1 },
    });
    expect(skipped.ok).toBe(false);
    if (!skipped.ok) expect(skipped.errors[0]!.code).toBe('invalid_field');
  });

  it('v1 without a null supersedes is refused (chain contiguity)', () => {
    const v1 = mintCredentialEnvelope(declaration());
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    const weird = validateCredentialEnvelope({ ...v1.value, version: 2, supersedes: null });
    expect(weird.ok).toBe(false);
  });
});

describe('the derived resolution verdict (immutable records, derived state)', () => {
  it('the latest active version resolves active', () => {
    const v1 = mintCredentialEnvelope(declaration());
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    expect(credentialStatus(v1.value, v1.value).kind).toBe('active');
  });

  it('a superseded version is retired (rotation)', () => {
    const v1 = mintCredentialEnvelope(declaration());
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    const v2 = reviseCredentialEnvelope(v1.value, { status: 'active', asOf: (T0 + 1) as TimestampMs });
    expect(v2.ok).toBe(true);
    if (!v2.ok) return;
    const verdict = credentialStatus(v1.value, v2.value);
    expect(verdict.kind).toBe('retired');
    if (verdict.kind === 'retired') expect(verdict.latestVersion).toBe(2);
  });

  it('a revocation tombstone kills the whole envelope (no un-revocation)', () => {
    const v1 = mintCredentialEnvelope(declaration());
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    const tombstone = reviseCredentialEnvelope(v1.value, { status: 'revoked', asOf: (T0 + 5) as TimestampMs });
    expect(tombstone.ok).toBe(true);
    if (!tombstone.ok) return;
    expect(credentialStatus(tombstone.value, tombstone.value).kind).toBe('revoked');
    // Even the old active v1 is dead under the tombstone chain head.
    expect(credentialStatus(v1.value, tombstone.value).kind).toBe('revoked');
  });
});

describe('the injection receipt (the runtime-boundary fact, value-free)', () => {
  it('records the fact without any payload and validates', () => {
    const v1 = mintCredentialEnvelope(declaration());
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    const receipt = credentialInjectionReceipt({
      envelope: { envelopeId: v1.value.envelopeId, version: 1 },
      runtime: 'ep-0123abcd',
      injectedAt: (T0 + 10) as TimestampMs,
      injectedBy: 'operator:ada',
      tenant: TENANT,
      project: PROJECT,
    });
    expect(receipt.ok).toBe(true);
    if (receipt.ok) {
      expect(isCredentialInjectionReceipt(receipt.value)).toBe(true);
      expect(JSON.stringify(receipt.value)).not.toContain('CANARY');
    }
  });

  it('a receipt carrying credential material is inexpressible', () => {
    const receipt = credentialInjectionReceipt({
      envelope: { envelopeId: 'cred:0123abcd' as CredentialEnvelope['envelopeId'], version: 1 },
      runtime: 'ep-0123abcd',
      injectedAt: T0,
      injectedBy: 'operator:ada',
      tenant: TENANT,
      project: PROJECT,
      token: 'THE-SECRET-ITSELF',
    } as unknown as Parameters<typeof credentialInjectionReceipt>[0]);
    expect(receipt.ok).toBe(false);
    if (!receipt.ok) expect(receipt.errors[0]!.code).toBe('credential_value_present');
  });
});

describe('content addressing law (L9)', () => {
  it('the canonical content tree excludes the id and is byte-stable under input order variation', () => {
    const a = mintCredentialEnvelope(declaration());
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const reordered = mintCredentialEnvelope({
      status: a.value.status,
      asOf: a.value.asOf,
      fingerprint: a.value.fingerprint,
      kind: a.value.kind,
      venue: a.value.venue,
      project: a.value.project,
      tenant: a.value.tenant,
    });
    expect(reordered.ok).toBe(true);
    if (reordered.ok) {
      expect(reordered.value.envelopeId).toBe(a.value.envelopeId);
      expect(JSON.stringify(envelopeContentTree(reordered.value))).toBe(JSON.stringify(envelopeContentTree(a.value)));
    }
  });

  it('any content change changes the v1 id', () => {
    const a = mintCredentialEnvelope(declaration());
    const b = mintCredentialEnvelope(declaration({ kind: 'hmac_secret' }));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.envelopeId).not.toBe(b.value.envelopeId);
  });
});
