/**
 * T044 INTEGRATION — cross-lane interop trip wires (T005 / T019 / T040
 * composition through the security substrate).
 *
 * THE LAW (D-003/D-004): cross-package shapes are consumed via
 * STRUCTURAL MIRRORS + interop trip-wire tests only — never imports of
 * other workspace packages in SOURCES. This file is the integration
 * half of the trip wire (the package half lives in
 * packages/security/src/interop.test.ts): it drives the REAL T005
 * protocol, the REAL T040 authority package and the REAL T044
 * enforcement service together and proves:
 *
 *   1. TYPE LEVEL: the REAL T005 EnvironmentSpec IS the T044 mirror;
 *      the REAL T040 AuthorityGrantRecord IS the T044 mirror; the REAL
 *      T040 GatewayAuditRecord id space IS the T044 composition space —
 *      mutually assignable, NO CASTS.
 *   2. RUNTIME (T005 composition): a REAL spec validated by the REAL
 *      T005 validators passes the T044 mirror guard; the mirror's
 *      canonical JSON and episode-id derivation are byte-identical to
 *      the REAL T005 functions; a REAL episode started by the REAL T005
 *      `startEpisode` is admitted by the T044 policy and the admission
 *      record binds THAT episode id.
 *   3. RUNTIME (T040 composition): a grant minted by the REAL T040
 *      minter passes the T044 mirror's guard and content-address law;
 *      the grant's 'cred:' credential binding IS a valid T044 envelope
 *      id (the referent this lane owns); the grant's window predicate
 *      agrees at every boundary; a REAL T040 GatewayAuditRecord is
 *      referenced OPAQUELY from a T044 SecurityAuditRecord (the
 *      complement law: join key present, payload never copied).
 *   4. RUNTIME (one opacity law): the T019, T040 and T044 credential
 *      trip wires flag identical trees.
 */

import { describe, expect, it } from 'vitest';

// The T044 contracts package (the mirrors) and service (the enforcement).
import {
  canonicalGrantJson as t044CanonicalGrantJson,
  canonicalSpecJson as t044CanonicalSpecJson,
  credentialFingerprint,
  credentialValueViolations as t044CredentialViolations,
  deriveEpisodeId as t044DeriveEpisodeId,
  grantStatus as t044GrantStatus,
  gatewayAuditObjectRef,
  isAuthorityGrantRecord as t044IsGrant,
  isEnvironmentSpec as t044IsSpec,
  mintEpisodeAdmission,
  mintIsolationDescriptor,
  securityAuditRecordAt,
  startSecurityAuditTrail,
  appendSecurityAuditRecord,
  verifySecurityAuditChain,
  validateAuthorityGrant as t044ValidateGrant,
  type AuthorityGrantRecord as T044Grant,
  type EnvironmentSpec as T044Spec,
  type ProjectId,
  type Scope,
  type TenantId,
  type TimestampMs,
} from '../../packages/security/src/index';
import {
  contextAdmitEpisode,
  contextRegisterEnvelope,
  contextRegisterProject,
  contextRegisterTenant,
  createSecurityContext,
} from '../../services/security/src/index';

// The REAL T005 environment protocol (tests only — relative imports).
import {
  canonicalSpecJson as t005CanonicalSpecJson,
  createClockConfig,
  deriveEpisodeId as t005DeriveEpisodeId,
  emitObservations,
  startEpisode,
  submitAction,
  validateEnvironmentSpec,
  type EnvironmentSpec as T005Spec,
  type TimestampMs as T005TimestampMs,
} from '../../packages/environment-protocol/src/index';

// The REAL T040 execution-authority package (tests only).
import {
  appendGatewayAuditRecord,
  canonicalGrantJson as t040CanonicalGrantJson,
  credentialValueViolations as t040CredentialViolations,
  gatewayAuditRecordAt,
  grantStatus as t040GrantStatus,
  mintAuthorityGrant as t040MintGrant,
  startGatewayAuditTrail,
  verifyGatewayAuditChain,
  type AuthorityGrantRecord as T040Grant,
  type CredentialRef as T040CredentialRef,
  type ProjectId as T040ProjectId,
  type TenantId as T040TenantId,
} from '../../packages/execution-authority/src/index';

// The REAL T019 execution-policy trip wire (tests only).
import { credentialValueViolations as t019CredentialViolations } from '../../packages/execution-policy/src/index';

const T0 = 1_717_459_200_000 as TimestampMs;

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` on drift). No casts: the
// mirrors must be structurally identical.
// ---------------------------------------------------------------------------

/** Compiles iff the REAL T005 EnvironmentSpec IS the T044 mirror spec. */
function realSpecIsMirror(value: T005Spec): T044Spec {
  return value;
}

/** Compiles iff the T044 mirror spec IS the REAL T005 spec. */
function mirrorSpecIsReal(value: T044Spec): T005Spec {
  return value;
}

/** Compiles iff the REAL T040 AuthorityGrantRecord IS the T044 mirror grant. */
function realGrantIsMirror(value: T040Grant): T044Grant {
  return value;
}

/** Compiles iff the T044 mirror grant IS the REAL T040 grant. */
function mirrorGrantIsReal(value: T044Grant): T040Grant {
  return value;
}

/** Compiles iff the scope/id spaces are one space across T040 and T044. */
function scopeIsOneSpace(tenant: T040TenantId, project: T040ProjectId): { tenant: TenantId; project: ProjectId } {
  return { tenant, project };
}

void realSpecIsMirror;
void mirrorSpecIsReal;
void realGrantIsMirror;
void mirrorGrantIsReal;
void scopeIsOneSpace;

// ---------------------------------------------------------------------------
// Fixtures built with the REAL packages
// ---------------------------------------------------------------------------

function realT005Spec(): T005Spec {
  const clock = unwrap(createClockConfig({ asOf: (T0 + 86_400_000) as T005TimestampMs, now: T0, fidelity: 'exact_replay' }));
  return unwrap(
    validateEnvironmentSpec({
      profile: {
        environment_id: 'env-interop-e2e',
        fidelity: 'exact_replay',
        clock,
        seed: 'seed-interop-e2e',
        venue_scope: ['binance'],
        instrument_scope: ['BTC-USDT'],
        latency_policy: null,
        fee_policy: null,
      },
      world: { world_id: 'world-interop-e2e', kind: 'replay' },
      information_policy: 'point-in-time',
    }),
  );
}

function realT040Grant(): T040Grant {
  return unwrap(
    t040MintGrant({
      version: 1,
      supersedes: null,
      tenant: 'tenant-interop-e2e' as T040TenantId,
      project: 'project-interop-e2e' as T040ProjectId,
      principal: { specId: 'spec-interop' as T040Grant['principal']['specId'], version: 2 },
      scopeRef: 'grant:interop-e2e-1' as never,
      orderKinds: ['limit', 'market'],
      venues: ['binance'] as never,
      rateBudgets: [{ venue: 'binance' as never, windowMs: 60_000, maxOrders: 3 }],
      credentials: [{ venue: 'binance' as never, credentialRef: 'cred:interop-e2e' as T040CredentialRef }],
      validity: { issuedAt: T0 as T005TimestampMs, expiresAt: (T0 + 7_200_000) as T005TimestampMs },
      revocations: [],
      asOf: T0 as T005TimestampMs,
    }),
  );
}

// ---------------------------------------------------------------------------
// The trip wires
// ---------------------------------------------------------------------------

describe('T005 composition (the isolated workload unit)', () => {
  it('a REAL T005 spec passes the T044 mirror guard and digests byte-identically', () => {
    const spec = realT005Spec();
    expect(t044IsSpec(spec)).toBe(true);
    expect(t044CanonicalSpecJson(spec)).toBe(t005CanonicalSpecJson(spec));
    expect(t044DeriveEpisodeId(spec)).toBe(t005DeriveEpisodeId(spec));
  });

  it('a REAL T005 episode (started + driven by the REAL protocol) is admitted by the T044 policy and the admission binds THAT episode id', () => {
    const spec = realT005Spec();
    // Start and drive a REAL episode with the REAL protocol.
    let episode = unwrap(startEpisode(spec));
    episode = unwrap(
      emitObservations(episode, [
        {
          observation_id: 'obs-interop-1',
          available_time: T0 as T005TimestampMs,
          venue: 'binance',
          instrument: 'BTC-USDT',
          payload: { last: 42000.5 },
          provenance: { origin: 'simulated', source: null, derived_from: [] },
        },
      ]),
    );
    episode = unwrap(
      submitAction(episode, {
        action_id: 'act-1',
        actor: 'agent-interop-1',
        submitted_at: T0 as T005TimestampMs,
        client_sequence: 1,
        payload: { kind: 'probe', body: { venue: 'binance' } },
      }),
    );
    expect(episode.accepted_actions).toHaveLength(1);

    // The T044 admission of the SAME spec binds the REAL episode id.
    const descriptor = unwrap(
      mintIsolationDescriptor({
        workloadKind: 'episode', egress: 'none', networkAllowlist: [], filesystem: 'scratch',
        credentialAccess: 'envelope_refs_only', maxSteps: 500,
        tenant: 'tenant-interop-e2e' as TenantId, project: 'project-interop-e2e' as ProjectId, asOf: T0,
      }),
    );
    const admission = unwrap(mintEpisodeAdmission(spec, descriptor, 'operator:interop', (T0 + 5) as TimestampMs));
    expect(String(admission.episodeId)).toBe(String(episode.episode_id));
    expect(admission.specDigest).toMatch(/^[0-9a-f]{8}$/);

    // And through the enforcement service end-to-end.
    const context = createSecurityContext();
    const scope: Scope = { tenant: 'tenant-interop-e2e' as TenantId, project: 'project-interop-e2e' as ProjectId };
    expect(contextRegisterTenant(context, scope.tenant, T0).ok).toBe(true);
    expect(contextRegisterProject(context, scope, (T0 + 1) as TimestampMs).ok).toBe(true);
    const admitted = contextAdmitEpisode(context, { scope, spec, descriptor, admittedBy: 'operator:interop', admittedAt: (T0 + 6) as TimestampMs });
    expect(admitted.ok).toBe(true);
    if (admitted.ok) expect(String(admitted.admission.episodeId)).toBe(String(episode.episode_id));
  });

  it('seed sensitivity parity: changing the seed changes BOTH derivations identically', () => {
    const specA = realT005Spec();
    const specB = { ...specA, profile: { ...specA.profile, seed: 'seed-interop-e2e-v2' } } as T005Spec;
    expect(validateEnvironmentSpec(specB).ok).toBe(true);
    expect(t044DeriveEpisodeId(specB)).toBe(t005DeriveEpisodeId(specB));
    expect(t044DeriveEpisodeId(specB)).not.toBe(t044DeriveEpisodeId(specA));
  });
});

describe('T040 composition (the authority lane)', () => {
  it('a REAL T040 grant passes the T044 mirror guard, validator and content-address law; canonical JSON is byte-identical', () => {
    const grant = realT040Grant();
    expect(t044IsGrant(grant)).toBe(true);
    const validated = t044ValidateGrant(grant);
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.value).toBe(grant);
    expect(t044CanonicalGrantJson(grant)).toBe(t040CanonicalGrantJson(grant));
  });

  it('the grant validity-window predicate agrees at EVERY boundary instant', () => {
    const grant = realT040Grant();
    const { issuedAt, expiresAt } = grant.validity;
    for (const now of [issuedAt - 1, issuedAt, expiresAt - 1, expiresAt, expiresAt + 1]) {
      expect(t044GrantStatus(grant, now as TimestampMs)).toEqual(t040GrantStatus(grant, now as T005TimestampMs));
    }
  });

  it("the grant's 'cred:' credential binding IS a valid T044 envelope id (T044 owns the referent)", () => {
    const grant = realT040Grant();
    const binding = grant.credentials[0]!;
    // The T044 id space accepts the T040 binding verbatim...
    expect(binding.credentialRef.startsWith('cred:')).toBe(true);
    // ...and the T044 envelope lane can register the referent under that same id space.
    const context = createSecurityContext();
    const scope: Scope = { tenant: grant.tenant as TenantId, project: grant.project as ProjectId };
    expect(contextRegisterTenant(context, scope.tenant, T0).ok).toBe(true);
    expect(contextRegisterProject(context, scope, (T0 + 1) as TimestampMs).ok).toBe(true);
    const envelope = contextRegisterEnvelope(context, {
      tenant: scope.tenant, project: scope.project, venue: binding.venue as never, kind: 'api_key',
      fingerprint: credentialFingerprint('INTEROP-E2E-SECRET'), asOf: (T0 + 2) as TimestampMs,
    });
    expect(envelope.ok).toBe(true);
    if (envelope.ok) expect(envelope.value.envelopeId.startsWith('cred:')).toBe(true);
  });

  it('a REAL T040 GatewayAuditRecord composes into the T044 security-audit trail via the OPAQUE ref (the complement law)', () => {
    const tenant = 'tenant-interop-e2e' as T040TenantId;
    const project = 'project-interop-e2e' as T040ProjectId;
    // Build a REAL T040 audit record with the REAL trail minter.
    let gatewayTrail = unwrap(startGatewayAuditTrail(tenant, project));
    const gatewayRecord = unwrap(
      gatewayAuditRecordAt(gatewayTrail, {
        who: {
          bodyVersion: { specId: 'spec-interop' as T040Grant['principal']['specId'], version: 2 },
          intentRef: 'si:interop-1',
          decisionId: null,
          decisionKind: null,
          clientOrderId: 'coi-interop-1',
        },
        substrate: 'substrate:glm-1',
        policy: { policyId: 'xpol:interop', version: 1 },
        visibleState: { venue: 'binance', instrument: 'BTC-USDT', instrumentClass: 'spot', referencePrice: '42000.50', rateWindowOrderCount: 0, riskExposureRef: null },
        riskChecks: { evaluationId: null, riskPolicy: { policyId: 'rp:interop', version: 1 }, within: 0, breaching: 0, blocked: 1 },
        order: null,
        execution: null,
        outcome: 'refused',
        refusal: { stage: 'risk', code: 'limit_breached', detail: null },
        tenant,
        project,
        lineage: {
          intentRef: 'si:interop-1',
          strategy: { specId: 'spec-interop', version: 2 },
          goal: { goalId: 'goal:interop', version: 1 },
          policy: { policyId: 'xpol:interop', version: 1 },
          venues: ['binance'],
          seed: 'seed-interop-e2e',
          tenant,
          project,
        },
        asOf: (T0 + 10) as T005TimestampMs,
      }),
    );
    gatewayTrail = unwrap(appendGatewayAuditRecord(gatewayTrail, gatewayRecord));

    // Reference it OPAQUELY from a REAL T044 security-audit record.
    const ref = gatewayAuditObjectRef(gatewayRecord.auditId, tenant as TenantId, project as ProjectId);
    let securityTrail = unwrap(startSecurityAuditTrail(tenant as TenantId, project as ProjectId));
    const securityRecord = unwrap(
      securityAuditRecordAt(securityTrail, {
        actor: { principal: 'execution-gateway', kind: 'service' },
        action: 'credential_resolution_refused',
        decision: 'denied',
        subject: { kind: 'envelope', ref: 'cred:interop-e2e@1' },
        detail: { reason: 'risk refusal upstream' },
        gatewayAudit: ref,
        tenant: tenant as TenantId,
        project: project as ProjectId,
        asOf: (T0 + 11) as TimestampMs,
      }),
    );
    securityTrail = unwrap(appendSecurityAuditRecord(securityTrail, securityRecord));

    // THE COMPLEMENT LAW: the join key IS present; the T040 payload is NOT copied.
    const serialized = JSON.stringify(securityRecord);
    expect(serialized).toContain(gatewayRecord.auditId);
    expect(serialized).toContain('"kind":"gateway_audit"');
    expect(serialized).not.toContain('"visibleState"');
    expect(serialized).not.toContain('"riskChecks"');
    expect(serialized).not.toContain('clientOrderId');
    expect(serialized).not.toContain('referencePrice');
    // And both chains verify independently.
    expect(verifyGatewayAuditChain(gatewayTrail).ok).toBe(true);
    expect(verifySecurityAuditChain(securityTrail).ok).toBe(true);
  });
});

describe('one opacity law across the three lanes (T019 / T040 / T044)', () => {
  it('the three trip wires flag identical trees with identical paths', () => {
    const trees = [
      { apiKey: 'A' },
      { deep: { 'API-KEY': 'B', seedPhrase: 'one two' } },
      [{ token: 'C' }, { safe: true }],
      { venue: 'binance', envelopeId: 'cred:ok', fingerprint: '0123abcd' },
    ];
    for (const tree of trees) {
      const t044 = t044CredentialViolations(tree);
      expect(t044).toEqual(t040CredentialViolations(tree));
      expect(t044).toEqual(t019CredentialViolations(tree));
    }
    // The last tree is clean in all three lanes.
    expect(t044CredentialViolations(trees[3])).toEqual([]);
  });

  it('a REAL T040 grant binding a T044 envelope id serializes clean in all lanes', () => {
    const grant = realT040Grant();
    expect(t044CredentialViolations(grant)).toEqual([]);
    expect(t040CredentialViolations(grant)).toEqual([]);
    expect(t019CredentialViolations(grant)).toEqual([]);
  });
});

describe('end-to-end determinism across the composition', () => {
  it('the same (REAL spec, descriptor, principal, instant) produce the same admission id — twice', () => {
    const spec = realT005Spec();
    const descriptor = unwrap(
      mintIsolationDescriptor({
        workloadKind: 'episode', egress: 'none', networkAllowlist: [], filesystem: 'scratch',
        credentialAccess: 'none', maxSteps: 5,
        tenant: 'tenant-interop-e2e' as TenantId, project: 'project-interop-e2e' as ProjectId, asOf: T0,
      }),
    );
    const first = unwrap(mintEpisodeAdmission(spec, descriptor, 'operator:interop', (T0 + 5) as TimestampMs));
    const second = unwrap(mintEpisodeAdmission(spec, descriptor, 'operator:interop', (T0 + 5) as TimestampMs));
    expect(second.admissionId).toBe(first.admissionId);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
