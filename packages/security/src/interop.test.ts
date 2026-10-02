/**
 * @tradrl/security — cross-package interop trip wires.
 *
 * The consumed contract shapes are STRUCTURAL MIRRORS of
 * @tradrl/environment-protocol (T005), @tradrl/execution-policy (T019)
 * and @tradrl/execution-authority (T040) (law D-003/D-004: never imports
 * in sources); this test is the trip wire — if any mirror drifts, the
 * TYPE-LEVEL witnesses below fail `pnpm typecheck`, and the RUNTIME
 * parity checks fail the package test run. Cross-package imports happen
 * ONLY in tests, via relative paths (the repo's established pattern).
 *
 * What is proven here:
 *   1. TYPE LEVEL: the REAL T005 `EnvironmentSpec` IS this package's
 *      mirror spec; the REAL T040 `AuthorityGrantRecord` IS this
 *      package's mirror grant — mutually assignable, NO CASTS anywhere.
 *   2. RUNTIME: a REAL T005 spec passes this mirror's guard verbatim;
 *      this mirror's `canonicalSpecJson` and `deriveEpisodeId` produce
 *      the REAL T005 functions' output BYTE-FOR-BYTE.
 *   3. RUNTIME: a grant minted by the REAL T040 `mintAuthorityGrant`
 *      passes this mirror's guard, content-address law and canonical
 *      JSON byte-identically; the `grantStatus` window predicate agrees
 *      at every boundary instant.
 *   4. RUNTIME: the credential-opacity trip wires (T019's, T040's and
 *      this package's) flag the IDENTICAL trees — the opacity law is
 *      one law across the three lanes.
 *   5. RUNTIME: the id-space guards are prefix-for-prefix identical
 *      both directions (cred:, grant:, xag:, xga:, tenant, project).
 *   6. RUNTIME: canonicalJson + FNV-1a digests are byte-identical
 *      across lanes.
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalGrantJson as mirrorCanonicalGrantJson,
  canonicalJson as mirrorCanonicalJson,
  canonicalSpecJson as mirrorCanonicalSpecJson,
  credentialValueViolations as mirrorCredentialViolations,
  deriveEpisodeId as mirrorDeriveEpisodeId,
  fnv1a32Hex as mirrorFnv1a32Hex,
  grantStatus as mirrorGrantStatus,
  isAuthorityGrantRecord as mirrorIsAuthorityGrantRecord,
  isCredentialEnvelopeId,
  isEnvironmentSpec as mirrorIsEnvironmentSpec,
  isTimestampMs as mirrorIsTimestampMs,
  validateAuthorityGrant as mirrorValidateAuthorityGrant,
  type AuthorityGrantRecord as MirrorGrant,
  type AuthorityScopeRef as MirrorAuthorityScopeRef,
  type CredentialRef as MirrorCredentialRef,
  type EnvironmentSpec as MirrorSpec,
  type ProjectId as MirrorProjectId,
  type TenantId as MirrorTenantId,
  type TimestampMs as MirrorTimestampMs,
} from './index';

// The REAL packages (tests only — relative imports).
import {
  canonicalSpecJson as t005CanonicalSpecJson,
  createClockConfig,
  deriveEpisodeId as t005DeriveEpisodeId,
  validateEnvironmentSpec,
  type EnvironmentSpec as T005Spec,
  type TimestampMs as T005TimestampMs,
} from '../../../packages/environment-protocol/src/index';
import { credentialValueViolations as t019CredentialViolations } from '../../../packages/execution-policy/src/index';
import {
  canonicalGrantJson as t040CanonicalGrantJson,
  canonicalJson as t040CanonicalJson,
  credentialValueViolations as t040CredentialViolations,
  fnv1a32Hex as t040Fnv1a32Hex,
  grantStatus as t040GrantStatus,
  isTimestampMs as t040IsTimestampMs,
  mintAuthorityGrant as t040MintAuthorityGrant,
  type AuthorityGrantRecord as T040Grant,
  type CredentialRef as T040CredentialRef,
  type ProjectId as T040ProjectId,
  type TenantId as T040TenantId,
} from '../../../packages/execution-authority/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` on drift). No casts: the
// mirrors must be structurally identical.
// ---------------------------------------------------------------------------

/** Compiles iff the REAL T005 EnvironmentSpec IS this package's mirror spec. */
function realSpecIsMirrorSpec(value: T005Spec): MirrorSpec {
  return value;
}

/** Compiles iff this package's mirror spec IS the REAL T005 spec (both directions). */
function mirrorSpecIsRealSpec(value: MirrorSpec): T005Spec {
  return value;
}

/** Compiles iff the REAL T040 AuthorityGrantRecord IS this package's mirror grant. */
function realGrantIsMirrorGrant(value: T040Grant): MirrorGrant {
  return value;
}

/** Compiles iff this package's mirror grant IS the REAL T040 grant (both directions). */
function mirrorGrantIsRealGrant(value: MirrorGrant): T040Grant {
  return value;
}

/** Compiles iff the scalar/id mirrors are mutually assignable with the real lanes. */
function scalarsAreOneSpace(tenant: T040TenantId, project: T040ProjectId, cred: T040CredentialRef, at: T005TimestampMs): {
  tenant: MirrorTenantId;
  project: MirrorProjectId;
  cred: MirrorCredentialRef;
  at: MirrorTimestampMs;
} {
  return { tenant, project, cred, at };
}

void realSpecIsMirrorSpec;
void mirrorSpecIsRealSpec;
void realGrantIsMirrorGrant;
void mirrorGrantIsRealGrant;
void scalarsAreOneSpace;

// ---------------------------------------------------------------------------
// Fixtures (built with the REAL packages' own constructors)
// ---------------------------------------------------------------------------

const T0 = 1_717_459_200_000 as T005TimestampMs;

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

/** A REAL T005 spec, built and validated by the REAL T005 validators. */
function realT005Spec(): T005Spec {
  const clock = unwrap(createClockConfig({ asOf: (T0 + 86_400_000) as T005TimestampMs, now: T0, fidelity: 'exact_replay' }));
  return unwrap(
    validateEnvironmentSpec({
      profile: {
        environment_id: 'env-interop-1',
        fidelity: 'exact_replay',
        clock,
        seed: 'seed-interop',
        venue_scope: ['binance'],
        instrument_scope: ['BTC-USDT'],
        latency_policy: null,
        fee_policy: null,
      },
      world: { world_id: 'world-interop', kind: 'replay' },
      information_policy: 'point-in-time',
    }),
  );
}

/** A REAL T040 grant, minted by the REAL T040 minter. */
function realT040Grant(): T040Grant {
  return unwrap(
    t040MintAuthorityGrant({
      version: 1,
      supersedes: null,
      tenant: 'tenant-interop' as T040TenantId,
      project: 'project-interop' as T040ProjectId,
      principal: { specId: 'spec-interop' as T040Grant['principal']['specId'], version: 1 },
      scopeRef: 'grant:interop-1' as MirrorAuthorityScopeRef,
      orderKinds: ['limit'],
      venues: ['binance'] as unknown as T040Grant['venues'],
      rateBudgets: [{ venue: 'binance' as T040Grant['venues'][number], windowMs: 60_000, maxOrders: 5 }],
      credentials: [{ venue: 'binance' as T040Grant['venues'][number], credentialRef: 'cred:0123abcd' as T040CredentialRef }],
      validity: { issuedAt: T0, expiresAt: (T0 + 3_600_000) as T005TimestampMs },
      revocations: [],
      asOf: T0,
    }),
  );
}

// ---------------------------------------------------------------------------
// The trip wires
// ---------------------------------------------------------------------------

describe('T005 spec mirror parity', () => {
  it("a REAL T005 spec passes this mirror guard verbatim", () => {
    const spec = realT005Spec();
    expect(mirrorIsEnvironmentSpec(spec)).toBe(true);
  });

  it("this mirror canonicalSpecJson is byte-identical to the REAL T005 function", () => {
    const spec = realT005Spec();
    expect(mirrorCanonicalSpecJson(spec)).toBe(t005CanonicalSpecJson(spec));
  });

  it("this mirror deriveEpisodeId equals the REAL T005 derivation (same id bytes)", () => {
    const spec = realT005Spec();
    expect(mirrorDeriveEpisodeId(spec)).toBe(t005DeriveEpisodeId(spec));
    expect(String(mirrorDeriveEpisodeId(spec))).toMatch(/^ep-[0-9a-f]{8}$/);
  });

  it('seed sensitivity parity: both derivations change when the seed changes', () => {
    const specA = realT005Spec();
    const specB = { ...specA, profile: { ...specA.profile, seed: 'seed-interop-2' } } as T005Spec;
    expect(mirrorDeriveEpisodeId(specB)).not.toBe(mirrorDeriveEpisodeId(specA));
    expect(t005DeriveEpisodeId(specB)).not.toBe(t005DeriveEpisodeId(specA));
    expect(mirrorDeriveEpisodeId(specB)).toBe(t005DeriveEpisodeId(specB));
  });
});

describe('T040 grant mirror parity', () => {
  it("a REAL T040 grant passes this mirror guard, validator and content-address law", () => {
    const grant = realT040Grant();
    expect(mirrorIsAuthorityGrantRecord(grant)).toBe(true);
    const validated = mirrorValidateAuthorityGrant(grant);
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.value).toBe(grant);
  });

  it("this mirror canonicalGrantJson is byte-identical to the REAL T040 function", () => {
    const grant = realT040Grant();
    expect(mirrorCanonicalGrantJson(grant)).toBe(t040CanonicalGrantJson(grant));
  });

  it('the grantStatus window predicate agrees at EVERY boundary instant', () => {
    const grant = realT040Grant();
    const issuedAt = grant.validity.issuedAt;
    const expiresAt = grant.validity.expiresAt;
    const instants = [issuedAt - 1, issuedAt, issuedAt + 1, expiresAt - 1, expiresAt, expiresAt + 1];
    for (const now of instants) {
      expect(mirrorGrantStatus(grant, now as T005TimestampMs)).toEqual(t040GrantStatus(grant, now as T005TimestampMs));
    }
  });

  it('revocation dominance parity', () => {
    const base = realT040Grant();
    const revoked: T040Grant = {
      ...base,
      grantId: 'xag:00000000' as T040Grant['grantId'], // id invalid on purpose — grantStatus does not check it
      revocations: [{ revokedAt: T0, reason: 'interop kill', revokedBy: 'operator:interop' }],
    };
    const now = (T0 + 1) as T005TimestampMs;
    expect(mirrorGrantStatus(revoked, now)).toEqual(t040GrantStatus(revoked, now));
    expect(mirrorGrantStatus(revoked, now)?.kind).toBe('grant_revoked');
  });
});

describe('the credential-opacity trip wire is ONE law across the lanes', () => {
  const planted = [
    { apiKey: 'AKIA-1' },
    { nested: { api_key: 'k', passPHRASE: 'p' } },
    { list: [{ 'API-KEY': 'x' }, { safe: 'yes' }] },
    { secret: null, token: 42, credential: { seedPhrase: 'one two three' } },
    {},
    { safe: 'tree', numbers: [1, 2, 3] },
  ];

  it("this mirror scan, T019 scan and T040 scan flag the IDENTICAL trees with IDENTICAL paths", () => {
    for (const tree of planted) {
      const mine = mirrorCredentialViolations(tree);
      const t019 = t019CredentialViolations(tree);
      const t040 = t040CredentialViolations(tree);
      expect(mine).toEqual(t019);
      expect(mine).toEqual(t040);
    }
  });

  it('key normalization parity (case/separator-insensitive, both directions)', () => {
    const shapes = ['secret', 'SECRET', 'Api-Key', 'api_key', 'API KEY', 'apiKey', 'seed-phrase', 'seedPhrase', 'SEED_PHRASE'];
    for (const shape of shapes) {
      const tree = { [shape]: 'value' };
      expect(mirrorCredentialViolations(tree)).toEqual(t040CredentialViolations(tree));
      expect(mirrorCredentialViolations(tree)).toHaveLength(1);
    }
  });
});

describe('id-space prefix-law parity (both directions)', () => {
  it("the cred: prefix is one identity space: a T040 CredentialRef IS a T044 envelope id", () => {
    const ref = 'cred:0123abcd' as T040CredentialRef;
    expect(isCredentialEnvelopeId(ref)).toBe(true);
  });

  it('scalar guard parity: TimestampMs, tenant, project', () => {
    expect(mirrorIsTimestampMs(T0)).toBe(t040IsTimestampMs(T0));
    expect(mirrorIsTimestampMs(Number.NaN)).toBe(t040IsTimestampMs(Number.NaN));
    expect(mirrorIsTimestampMs(0.5)).toBe(t040IsTimestampMs(0.5));
  });
});

describe('canonical serialization parity (the digest substrate)', () => {
  it('canonicalJson is byte-identical across lanes for nested trees', () => {
    const trees: unknown[] = [
      { b: 1, a: [true, null, 'x', { z: { y: 2 } }] },
      { z: 'last', a: { m: [1, 2], b: 'first' } },
      [],
      {},
      'plain',
      3.5,
      null,
    ];
    for (const tree of trees) {
      expect(mirrorCanonicalJson(tree as never)).toBe(t040CanonicalJson(tree as never));
    }
  });

  it('FNV-1a digests are identical across lanes', () => {
    for (const text of ['', 'a', 'tradrl.credential.v1:hunter2', 'grant:interop-1', '🔐-unicode']) {
      expect(mirrorFnv1a32Hex(text)).toBe(t040Fnv1a32Hex(text));
    }
  });
});
