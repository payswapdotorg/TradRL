/**
 * @tradrl/security — the grant-mirror tests (T040's grant.ts, mirrored).
 *
 * Pins the mirror's own laws (a REAL T040 grant proving parity lives in
 * interop.test.ts): the structural guard; the validity-window predicate
 * at every boundary ([issuedAt, expiresAt) — inclusive/exclusive);
 * revocation dominance; the opacity trip wire; mint + content
 * addressing; the version-chain law.
 */
import { describe, expect, it } from 'vitest';

import {
  canonicalGrantJson,
  grantContentTree,
  grantStatus,
  isAuthorityGrantRecord,
  mintAuthorityGrant,
  validateAuthorityGrant,
  type AuthorityGrantRecord,
  type TimestampMs,
} from './index';

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT = 'tenant-grants' as Omit<AuthorityGrantRecord, 'grantId'>['tenant'];
const PROJECT = 'project-grants' as Omit<AuthorityGrantRecord, 'grantId'>['project'];

function declaration(overrides: Partial<Omit<AuthorityGrantRecord, 'grantId'>> = {}): Omit<AuthorityGrantRecord, 'grantId'> {
  return {
    version: 1,
    supersedes: null,
    tenant: TENANT,
    project: PROJECT,
    principal: { specId: 'spec-momentum' as AuthorityGrantRecord['principal']['specId'], version: 3 },
    scopeRef: 'grant:scope-1' as AuthorityGrantRecord['scopeRef'],
    orderKinds: ['limit', 'market'],
    venues: ['binance', 'kraken'] as unknown as AuthorityGrantRecord['venues'],
    rateBudgets: [
      { venue: 'binance' as AuthorityGrantRecord['venues'][number], windowMs: 60_000, maxOrders: 10 },
      { venue: 'kraken' as AuthorityGrantRecord['venues'][number], windowMs: 60_000, maxOrders: 5 },
    ],
    credentials: [
      { venue: 'binance' as AuthorityGrantRecord['venues'][number], credentialRef: 'cred:0123abcd' as AuthorityGrantRecord['credentials'][number]['credentialRef'] },
      { venue: 'kraken' as AuthorityGrantRecord['venues'][number], credentialRef: 'cred:4567ef01' as AuthorityGrantRecord['credentials'][number]['credentialRef'] },
    ],
    validity: { issuedAt: T0, expiresAt: (T0 + 3_600_000) as TimestampMs },
    // (both instants are branded TimestampMs literals)
    revocations: [],
    asOf: T0,
    ...overrides,
  };
}

describe('minting and the guard', () => {
  it('mints a content-addressed grant that passes its own guard, deterministically', () => {
    const a = mintAuthorityGrant(declaration());
    const b = mintAuthorityGrant(declaration());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.grantId).toBe(b.value.grantId);
      expect(a.value.grantId.startsWith('xag:')).toBe(true);
      expect(isAuthorityGrantRecord(a.value)).toBe(true);
      expect(canonicalGrantJson(a.value)).toBe(canonicalGrantJson(b.value));
    }
  });

  it('a forged id fails the content-address law', () => {
    const minted = mintAuthorityGrant(declaration());
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    const forged = validateAuthorityGrant({ ...minted.value, grantId: 'xag:00000000' as AuthorityGrantRecord['grantId'] });
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.errors[0]!.code).toBe('invalid_field');
  });

  it('an empty or inverted validity window is inexpressible', () => {
    for (const validity of [{ issuedAt: T0, expiresAt: T0 as TimestampMs }, { issuedAt: (T0 + 1) as TimestampMs, expiresAt: T0 }]) {
      const result = mintAuthorityGrant(declaration({ validity }));
      expect(result.ok).toBe(false);
    }
  });

  it('the opacity trip wire refuses a value anywhere (reported first)', () => {
    const result = mintAuthorityGrant(declaration({ ...({ apiKey: 'x' } as unknown as Partial<Omit<AuthorityGrantRecord, 'grantId'>>) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('credential_value_present');
    expect(isAuthorityGrantRecord({ ...declaration(), grantId: 'xag:0123abcd', apiKey: 'x' })).toBe(false);
  });

  it('the version-chain law: supersedes must name a strictly earlier version', () => {
    const v1 = mintAuthorityGrant(declaration());
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    const sameVersion = validateAuthorityGrant({
      ...declaration({ version: 2, supersedes: { grantId: v1.value.grantId, version: 2 } }),
      grantId: v1.value.grantId,
    });
    expect(sameVersion.ok).toBe(false);
    if (!sameVersion.ok) expect(sameVersion.errors[0]!.code).toBe('invalid_field');
  });

  it('collect-all: every missing field is reported', () => {
    const result = validateAuthorityGrant({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.errors.map((e) => e.path);
      for (const field of ['grantId', 'version', 'tenant', 'project', 'principal', 'scopeRef', 'orderKinds', 'venues', 'rateBudgets', 'credentials', 'validity', 'revocations', 'asOf']) {
        expect(paths, `field ${field} must be reported`).toContain(`grant.${field}`);
      }
    }
  });
});

describe('the validity-window predicate ([issuedAt, expiresAt))', () => {
  const ISSUED_AT: TimestampMs = T0;
  const EXPIRES_AT: TimestampMs = (T0 + 1_000) as TimestampMs;

  it('now === issuedAt is valid (inclusive at issuance)', () => {
    const grant = mintAuthorityGrant(declaration({ validity: { issuedAt: ISSUED_AT as TimestampMs, expiresAt: EXPIRES_AT as TimestampMs } }));
    expect(grant.ok).toBe(true);
    if (grant.ok) expect(grantStatus(grant.value, ISSUED_AT)).toBeNull();
  });

  it('now === expiresAt - 1 is still valid', () => {
    const grant = mintAuthorityGrant(declaration({ validity: { issuedAt: ISSUED_AT as TimestampMs, expiresAt: EXPIRES_AT as TimestampMs } }));
    expect(grant.ok).toBe(true);
    if (grant.ok) expect(grantStatus(grant.value, (EXPIRES_AT - 1) as TimestampMs)).toBeNull();
  });

  it('now === expiresAt is EXPIRED (the boundary instant belongs to the dead side)', () => {
    const grant = mintAuthorityGrant(declaration({ validity: { issuedAt: ISSUED_AT as TimestampMs, expiresAt: EXPIRES_AT as TimestampMs } }));
    expect(grant.ok).toBe(true);
    if (grant.ok) {
      const refusal = grantStatus(grant.value, EXPIRES_AT);
      expect(refusal?.kind).toBe('grant_expired');
    }
  });

  it('now === issuedAt - 1 is NOT-YET-VALID', () => {
    const grant = mintAuthorityGrant(declaration({ validity: { issuedAt: ISSUED_AT as TimestampMs, expiresAt: EXPIRES_AT as TimestampMs } }));
    expect(grant.ok).toBe(true);
    if (grant.ok) {
      const refusal = grantStatus(grant.value, (ISSUED_AT - 1) as TimestampMs);
      expect(refusal?.kind).toBe('grant_not_yet_valid');
    }
  });

  it('revocation dominates the window (append-only, no un-revocation)', () => {
    const grant = mintAuthorityGrant(declaration({
      validity: { issuedAt: ISSUED_AT as TimestampMs, expiresAt: EXPIRES_AT as TimestampMs },
      revocations: [{ revokedAt: (ISSUED_AT + 1) as TimestampMs, reason: 'operator kill', revokedBy: 'operator:ada' }],
    }));
    expect(grant.ok).toBe(true);
    if (grant.ok) {
      const refusal = grantStatus(grant.value, (ISSUED_AT + 2) as TimestampMs);
      expect(refusal?.kind).toBe('grant_revoked');
      if (refusal?.kind === 'grant_revoked') expect(refusal.reason).toBe('operator kill');
    }
  });
});

describe('content tree (L9)', () => {
  it('is the explicit, id-free canonical form', () => {
    const grant = mintAuthorityGrant(declaration());
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;
    const tree = grantContentTree(grant.value);
    expect(Object.keys(tree as Record<string, unknown>).sort()).toEqual(
      ['asOf', 'credentials', 'orderKinds', 'principal', 'project', 'rateBudgets', 'revocations', 'scopeRef', 'supersedes', 'tenant', 'validity', 'venues', 'version'].sort(),
    );
    expect(tree).not.toHaveProperty('grantId');
  });
});
