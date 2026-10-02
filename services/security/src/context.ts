/**
 * @tradrl/security-service — the SecurityServiceContext: the composition
 * root of the enforcement plane.
 *
 * One context hosts the tenant isolation registry, the secrets vault,
 * the usage ledger and the per-scope security audit trails. EVERY
 * security-consequential act flows through the context so it is:
 *
 *   - ENFORCED (the registry/vault/policy laws above);
 *   - ACCOUNTED (a usage event fires — usage is an isolated surface);
 *   - AUDITED (a chain-verified SecurityAuditRecord lands in the ACTING
 *     scope's trail — who/what acted, scope, action class, decision).
 *
 * Denials are audited too: a cross-tenant attempt by a REGISTERED scope
 * emits a `cross_tenant_access_denied` record in the ACTOR's trail (the
 * actor's own trail is the correct evidence surface; the target's data
 * is never disclosed — ids only). Unregistered scopes have no trail and
 * receive typed errors at the door (`tenant_missing`).
 *
 * The context is deterministic: injected instants everywhere, insertion
 * order, content-addressed identities. `contextSnapshot` is the
 * JSON-serializable view (registry snapshot + envelopes + audit trails —
 * byte-scan proven secret-free by the integration tests).
 */

import {
  appendSecurityAuditRecord,
  credentialValueViolations,
  deepFreeze,
  isNonEmptyString,
  isTimestampMs,
  securityAuditRecordAt,
  startSecurityAuditTrail,
  verifySecurityAuditChain,
  type CredentialEnvelope,
  type CredentialVersionRef,
  type EpisodeAdmissionRecord,
  type EnvironmentSpec,
  type GatewayAuditObjectRef,
  type JsonValue,
  type ProjectId,
  type Scope,
  type SecurityAuditActionClass,
  type SecurityAuditActor,
  type SecurityAuditTrail,
  type TenantId,
  type TimestampMs,
  type WorkloadIsolationDescriptor,
} from '../../../packages/security/src/index';
import {
  createTenantIsolationRegistry,
  getScopedRecord,
  isScopeRegistered,
  isTenantRegistered,
  listScopedRecords,
  putScopedRecord,
  registerProject as registryRegisterProject,
  registerTenant as registryRegisterTenant,
  registrySnapshot,
  type IsolationSurface,
  type ScopedRegistryRecord,
  type TenantIsolationRegistry,
  type TenantIsolationRegistrySnapshot,
} from './registry';
import {
  createSecretsVault,
  depositSecretValue,
  registerCredentialEnvelope,
  resolveCredential,
  revokeCredential,
  rotateSecret,
  vaultEnvelopes,
  type CredentialResolution,
  type SecretsVault,
} from './secrets';
import { createUsageLedger, onUsage, recordUsage, usageFor, type ScopeUsage, type UsageEvent, type UsageLedger } from './usage';
import { admitEpisode, type EpisodeAdmission } from './isolation-policy';
import { exportTenantScope, type TenantExportBundle } from './exporter';

// ---------------------------------------------------------------------------
// The context
// ---------------------------------------------------------------------------

/** The security service context — registry + vault + ledger + audit trails. */
export interface SecurityServiceContext {
  readonly kind: 'tradrl/security-service-context/v1';
}

interface ContextState {
  readonly registry: TenantIsolationRegistry;
  readonly vault: SecretsVault;
  readonly ledger: UsageLedger;
  /** scopeKey -> the scope's audit trail (started lazily at the first event). */
  readonly trails: Map<string, SecurityAuditTrail>;
  /** scopeKey -> the trail's byte-size cache guard (the append-only mirror the tests verify). */
  readonly trailSizes: Map<string, number>;
}

const CONTEXT_STATES = new WeakMap<SecurityServiceContext, ContextState>();

function stateOf(context: SecurityServiceContext): ContextState {
  const state = CONTEXT_STATES.get(context);
  if (state === undefined) throw new Error('security service context: unknown context instance (create one with createSecurityContext)');
  return state;
}

/** Create an empty security service context (registry + vault + ledger + trails). */
export function createSecurityContext(): SecurityServiceContext {
  const context: SecurityServiceContext = { kind: 'tradrl/security-service-context/v1' };
  const ledger = createUsageLedger();
  const state: ContextState = {
    registry: createTenantIsolationRegistry(),
    vault: createSecretsVault(),
    ledger,
    trails: new Map(),
    trailSizes: new Map(),
  };
  CONTEXT_STATES.set(context, state);
  return Object.freeze(context);
}

// ---------------------------------------------------------------------------
// The audit emission (the context's ONLY trail-write path)
// ---------------------------------------------------------------------------

type AuditOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] };

function emit(
  context: SecurityServiceContext,
  scope: Scope,
  actor: SecurityAuditActor,
  action: SecurityAuditActionClass,
  decision: 'allowed' | 'denied',
  subject: { readonly kind: string; readonly ref: string } | null,
  detail: JsonValue | null,
  gatewayAudit: GatewayAuditObjectRef | null,
  at: TimestampMs,
): AuditOutcome {
  const state = stateOf(context);
  const key = `${scope.tenant}/${scope.project}`;
  let trail = state.trails.get(key);
  if (trail === undefined) {
    const started = startSecurityAuditTrail(scope.tenant, scope.project);
    if (!started.ok) return { ok: false, errors: started.errors.map((e) => ({ code: e.code, message: e.message })) };
    trail = started.value;
    state.trails.set(key, trail);
  }
  // The emission-site trip wire: audit facts are secret-free (the guard re-checks).
  if (credentialValueViolations(detail).length > 0) {
    return { ok: false, errors: [{ code: 'credential_value_present', message: 'audit detail may not carry credential material — who/what/scope/decision only' }] };
  }
  const minted = securityAuditRecordAt(trail, {
    actor,
    action,
    decision,
    subject,
    detail,
    gatewayAudit,
    tenant: scope.tenant,
    project: scope.project,
    asOf: at,
  });
  if (!minted.ok) return { ok: false, errors: minted.errors.map((e) => ({ code: e.code, message: e.message })) };
  const appended = appendSecurityAuditRecord(trail, minted.value);
  if (!appended.ok) return { ok: false, errors: appended.errors.map((e) => ({ code: e.code, message: e.message })) };
  state.trails.set(key, appended.value);
  state.trailSizes.set(key, appended.value.records.length);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Registration (audited)
// ---------------------------------------------------------------------------

/** Register a tenant (audited in the tenant's first trail — the scope is {tenant, tenant}). */
export function contextRegisterTenant(
  context: SecurityServiceContext,
  tenant: TenantId,
  at: TimestampMs,
  byPrincipal = 'control-plane',
): { readonly ok: true; readonly value: { readonly tenant: TenantId } } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(context);
  const result = registryRegisterTenant(state.registry, tenant, at);
  if (!result.ok) return result;
  // The tenant registration audit: scope is the tenant itself (project = tenant id; the project registers next).
  const audit = emit(context, { tenant, project: tenant as unknown as Scope['project'] }, { principal: byPrincipal, kind: 'service' }, 'tenant_registered', 'allowed', { kind: 'tenant', ref: tenant }, { registrationId: result.value.registrationId }, null, at);
  if (!audit.ok) return audit;
  return { ok: true, value: { tenant } };
}

/** Register a project under a registered tenant (audited in the scope's trail). */
export function contextRegisterProject(
  context: SecurityServiceContext,
  scope: Scope,
  at: TimestampMs,
  byPrincipal = 'control-plane',
): { readonly ok: true } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(context);
  const result = registryRegisterProject(state.registry, scope, at);
  if (!result.ok) return result;
  const audit = emit(context, scope, { principal: byPrincipal, kind: 'service' }, 'project_registered', 'allowed', { kind: 'project', ref: scope.project }, null, null, at);
  if (!audit.ok) return audit;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Scoped record writes (enforced + accounted + audited)
// ---------------------------------------------------------------------------

/** Write a scoped record onto a surface (registration-first, trip-wired, audited, usage-accounted). */
export function contextPutRecord(
  context: SecurityServiceContext,
  surface: IsolationSurface,
  record: { readonly tenant: TenantId; readonly project: ProjectId; readonly record_id: string; readonly payload: unknown; readonly asOf: TimestampMs },
): { readonly ok: true; readonly value: ScopedRegistryRecord } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(context);
  const result = putScopedRecord(state.registry, surface, record as never);
  if (!result.ok) return { ok: false, errors: result.errors };
  const scope: Scope = { tenant: result.value.tenant, project: result.value.project };
  const audit = emit(context, scope, { principal: 'security-context', kind: 'service' }, 'record_written', 'allowed', { kind: 'record', ref: `${surface}/${record.record_id}` }, { surface }, null, record.asOf);
  if (!audit.ok) return audit;
  const usage = recordUsage(state.ledger, scope, 'record_write', 1, `${surface}/${record.record_id}`, record.asOf);
  if (!usage.ok) return usage;
  return { ok: true, value: result.value };
}

/** Get one record AS a scope (the typed cross_tenant_access law; denials audited in the ACTOR's trail). */
export function contextGetRecord(
  context: SecurityServiceContext,
  surface: IsolationSurface,
  scope: Scope,
  recordId: string,
  at: TimestampMs,
): { readonly ok: true; readonly value: ScopedRegistryRecord } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(context);
  const result = getScopedRecord(state.registry, surface, scope, recordId);
  if (result.ok) return result;
  // Denials are audited (the ACTOR's trail; ids only, never the target's payload).
  if (result.errors[0]!.code === 'cross_tenant_access' && isScopeRegistered(state.registry, scope)) {
    emit(context, scope, { principal: 'security-context', kind: 'service' }, 'cross_tenant_access_denied', 'denied', { kind: 'record', ref: `${surface}/${recordId}` }, { surface }, null, at);
  }
  return { ok: false, errors: result.errors };
}

/** List a surface's records for a scope (scope-pure by construction). */
export function contextListRecords(context: SecurityServiceContext, surface: IsolationSurface, scope: Scope): readonly ScopedRegistryRecord[] {
  return listScopedRecords(stateOf(context).registry, surface, scope);
}

// ---------------------------------------------------------------------------
// The secrets boundary (enforced + accounted + audited)
// ---------------------------------------------------------------------------

/** Register a credential envelope (value-free; audited; accounted on the credentials surface). */
export function contextRegisterEnvelope(
  context: SecurityServiceContext,
  declaration: Parameters<typeof registerCredentialEnvelope>[1],
): { readonly ok: true; readonly value: CredentialEnvelope } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(context);
  const result = registerCredentialEnvelope(state.vault, declaration);
  if (!result.ok) return result;
  const scope: Scope = { tenant: result.value.tenant, project: result.value.project };
  // The envelope reference also lands on the tenant-isolated 'credentials' surface (records only — never values).
  const stored = putScopedRecord(state.registry, 'credentials', {
    tenant: result.value.tenant,
    project: result.value.project,
    record_id: `envelope:${result.value.envelopeId}`,
    payload: { envelopeId: result.value.envelopeId, version: result.value.version, kind: result.value.kind, venue: result.value.venue, fingerprint: result.value.fingerprint, status: result.value.status } as never,
    asOf: declaration.asOf,
  });
  if (!stored.ok) return { ok: false, errors: stored.errors };
  const audit = emit(context, scope, { principal: 'secrets-boundary', kind: 'service' }, 'credential_envelope_registered', 'allowed', { kind: 'envelope', ref: `${result.value.envelopeId}@${result.value.version}` }, { kind: declaration.kind, venue: declaration.venue }, null, declaration.asOf);
  if (!audit.ok) return audit;
  return { ok: true, value: result.value };
}

/** Deposit a secret value (the ONLY entry; fingerprint-verified; audited with a value-free receipt; the value NEVER serialized). */
export function contextDepositSecret(
  context: SecurityServiceContext,
  envelope: CredentialVersionRef,
  value: string,
  at: TimestampMs,
  byPrincipal = 'control-plane',
): { readonly ok: true; readonly receiptRef: string } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(context);
  const result = depositSecretValue(state.vault, envelope, value, at);
  if (!result.ok) return result;
  const scope: Scope = { tenant: result.value.tenant, project: result.value.project };
  const audit = emit(context, scope, { principal: byPrincipal, kind: 'service' }, 'secret_deposited', 'allowed', { kind: 'envelope', ref: `${envelope.envelopeId}@${envelope.version}` }, { runtime: result.value.runtime }, null, at);
  if (!audit.ok) return audit;
  return { ok: true, receiptRef: `${envelope.envelopeId}@${envelope.version}` };
}

/**
 * Resolve a credential FOR a scope — the runtime boundary exit. Audited
 * (allowed or the specific refusal class), usage-accounted. The VALUE
 * reaches only the caller's stack frame.
 */
export function contextResolveCredential(
  context: SecurityServiceContext,
  scope: Scope,
  envelope: CredentialVersionRef,
  runtime: string,
  at: TimestampMs,
): CredentialResolution {
  const state = stateOf(context);
  const result = resolveCredential(state.vault, scope, envelope, runtime, at);
  if (result.ok) {
    const audit = emit(context, scope, { principal: runtime, kind: 'workload' }, 'credential_resolved', 'allowed', { kind: 'envelope', ref: `${envelope.envelopeId}@${envelope.version}` }, { runtime }, null, at);
    if (!audit.ok) return { ok: false, refusal: { kind: 'secret_not_deposited', envelopeId: envelope.envelopeId, version: envelope.version }, errors: audit.errors };
    const usage = recordUsage(state.ledger, scope, 'credential_resolution', 1, `${envelope.envelopeId}@${envelope.version}`, at);
    if (!usage.ok) return { ok: false, refusal: { kind: 'secret_not_deposited', envelopeId: envelope.envelopeId, version: envelope.version }, errors: usage.errors };
    return result;
  }
  // Refusals are audited in the actor's trail (when registered) — the
  // cross-tenant attempt especially.
  if (result.refusal.kind === 'cross_tenant_access' && isScopeRegistered(state.registry, scope)) {
    emit(context, scope, { principal: runtime, kind: 'workload' }, 'credential_resolution_refused', 'denied', { kind: 'envelope', ref: `${envelope.envelopeId}@${envelope.version}` }, { reason: result.refusal.kind }, null, at);
    emit(context, scope, { principal: runtime, kind: 'workload' }, 'cross_tenant_access_denied', 'denied', { kind: 'envelope', ref: `${envelope.envelopeId}@${envelope.version}` }, { surface: 'credentials' }, null, at);
  } else if (isScopeRegistered(state.registry, scope)) {
    emit(context, scope, { principal: runtime, kind: 'workload' }, 'credential_resolution_refused', 'denied', { kind: 'envelope', ref: `${envelope.envelopeId}@${envelope.version}` }, { reason: result.refusal.kind }, null, at);
  }
  return result;
}

/** Rotate a credential (new version, same id; audited; the old version retires). */
export function contextRotateSecret(
  context: SecurityServiceContext,
  envelopeId: CredentialEnvelope['envelopeId'],
  newValue: string,
  at: TimestampMs,
  byPrincipal = 'control-plane',
): { readonly ok: true; readonly value: CredentialEnvelope } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(context);
  const result = rotateSecret(state.vault, envelopeId, newValue, at);
  if (!result.ok) return result;
  const scope: Scope = { tenant: result.value.envelope.tenant, project: result.value.envelope.project };
  const audit = emit(context, scope, { principal: byPrincipal, kind: 'service' }, 'credential_envelope_revised', 'allowed', { kind: 'envelope', ref: `${envelopeId}@${result.value.envelope.version}` }, { rotation: true }, null, at);
  if (!audit.ok) return audit;
  return { ok: true, value: result.value.envelope };
}

/** Revoke a credential (tombstone version; audited; no un-revocation). */
export function contextRevokeCredential(
  context: SecurityServiceContext,
  envelopeId: CredentialEnvelope['envelopeId'],
  at: TimestampMs,
  byPrincipal = 'control-plane',
): { readonly ok: true; readonly value: CredentialEnvelope } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(context);
  const result = revokeCredential(state.vault, envelopeId, at);
  if (!result.ok) return result;
  const scope: Scope = { tenant: result.value.tenant, project: result.value.project };
  const audit = emit(context, scope, { principal: byPrincipal, kind: 'service' }, 'credential_envelope_revised', 'allowed', { kind: 'envelope', ref: `${envelopeId}@${result.value.version}` }, { revoked: true }, null, at);
  if (!audit.ok) return audit;
  return { ok: true, value: result.value };
}

// ---------------------------------------------------------------------------
// Episode admission (enforced + accounted + audited)
// ---------------------------------------------------------------------------

/**
 * Admit an episode under an isolation descriptor — the T005 chokepoint.
 * Allowed admissions are stored on the 'trajectories' surface (the
 * workload's lineage fact) and audited; refusals are audited in the
 * actor's trail with the refusal class.
 */
export function contextAdmitEpisode(
  context: SecurityServiceContext,
  request: {
    readonly scope: Scope;
    readonly spec: EnvironmentSpec;
    readonly descriptor: WorkloadIsolationDescriptor | null;
    readonly admittedBy: string;
    readonly admittedAt: TimestampMs;
  },
): EpisodeAdmission {
  const state = stateOf(context);
  const result = admitEpisode(state.registry, request);
  if (result.ok) {
    const stored = putScopedRecord(state.registry, 'trajectories', {
      tenant: request.scope.tenant,
      project: request.scope.project,
      record_id: `admission:${result.admission.admissionId}`,
      payload: { admissionId: result.admission.admissionId, episodeId: result.admission.episodeId, descriptorId: result.admission.descriptorId, specDigest: result.admission.specDigest, constraints: result.admission.constraints, admittedBy: result.admission.admittedBy } as never,
      asOf: request.admittedAt,
    });
    if (!stored.ok) {
      return { ok: false, refusal: { kind: 'invalid_type', detail: 'the admission could not be stored on the trajectories surface' }, errors: stored.errors };
    }
    const audit = emit(context, request.scope, { principal: request.admittedBy, kind: 'operator' }, 'episode_admitted', 'allowed', { kind: 'episode', ref: result.admission.episodeId }, { descriptorId: result.admission.descriptorId, admissionId: result.admission.admissionId }, null, request.admittedAt);
    if (!audit.ok) return { ok: false, refusal: { kind: 'invalid_type', detail: 'audit emission failed' }, errors: audit.errors };
    const usage = recordUsage(state.ledger, request.scope, 'episode_admitted', 1, result.admission.episodeId, request.admittedAt);
    if (!usage.ok) return { ok: false, refusal: { kind: 'invalid_type', detail: 'usage accounting failed' }, errors: usage.errors };
    return result;
  }
  // Refusals are audited in the actor's trail (when registered).
  if (isScopeRegistered(state.registry, request.scope)) {
    emit(context, request.scope, { principal: request.admittedBy, kind: 'operator' }, 'episode_admission_refused', 'denied', { kind: 'episode', ref: 'unadmitted' }, { reason: result.refusal.kind }, null, request.admittedAt);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Export (R42; audited + accounted)
// ---------------------------------------------------------------------------

/** Export one scope (R42: excludes other-tenant data; never carries secret material). */
export function contextExportScope(
  context: SecurityServiceContext,
  scope: Scope,
  at: TimestampMs,
  byPrincipal = 'control-plane',
): { readonly ok: true; readonly value: TenantExportBundle } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(context);
  const result = exportTenantScope(state.registry, state.vault, state.ledger, scope, at);
  if (!result.ok) return result;
  const audit = emit(context, scope, { principal: byPrincipal, kind: 'service' }, 'scope_exported', 'allowed', { kind: 'bundle', ref: result.value.bundleId }, { surfaces: result.value.records.length, envelopes: result.value.credentialEnvelopes.length }, null, at);
  if (!audit.ok) return audit;
  const usage = recordUsage(state.ledger, scope, 'export', 1, result.value.bundleId, at);
  if (!usage.ok) return usage;
  return { ok: true, value: result.value };
}

// ---------------------------------------------------------------------------
// Views and verification
// ---------------------------------------------------------------------------

/** The scope's security audit trail (chain-verified copy — evidence, not scratch space). */
export function contextAuditTrail(context: SecurityServiceContext, scope: Scope): SecurityAuditTrail | null {
  return stateOf(context).trails.get(`${scope.tenant}/${scope.project}`) ?? null;
}

/** Verify EVERY trail's chain (the whole-context integrity proof). Returns the violation count (0 = clean). */
export function contextVerifyAllTrails(context: SecurityServiceContext): number {
  let violations = 0;
  for (const trail of stateOf(context).trails.values()) {
    if (!verifySecurityAuditChain(trail).ok) violations += 1;
  }
  return violations;
}

/** The registry snapshot (JSON-safe). */
export function contextRegistrySnapshot(context: SecurityServiceContext): TenantIsolationRegistrySnapshot {
  return registrySnapshot(stateOf(context).registry);
}

/** The vault's envelopes (value-free view). */
export function contextEnvelopes(context: SecurityServiceContext): readonly CredentialEnvelope[] {
  return vaultEnvelopes(stateOf(context).vault);
}

/** One scope's usage accounting. */
export function contextUsage(context: SecurityServiceContext, scope: Scope): { readonly ok: true; readonly value: ScopeUsage } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  return usageFor(stateOf(context).ledger, scope);
}

/** Register a usage hook (the accounting integration surface — see usage.ts). */
export function contextOnUsage(context: SecurityServiceContext, hook: (event: UsageEvent) => void): void {
  onUsage(stateOf(context).ledger, hook);
}

/** The JSON-serializable context snapshot: registry + envelopes + every trail (the integration tests byte-scan this for secrets). */
export function contextSnapshot(context: SecurityServiceContext): {
  readonly kind: 'tradrl/security-service-context-snapshot/v1';
  readonly registry: TenantIsolationRegistrySnapshot;
  readonly envelopes: readonly CredentialEnvelope[];
  readonly trails: readonly SecurityAuditTrail[];
} {
  const state = stateOf(context);
  return deepFreeze({
    kind: 'tradrl/security-service-context-snapshot/v1',
    registry: registrySnapshot(state.registry),
    envelopes: vaultEnvelopes(state.vault),
    trails: [...state.trails.values()],
  });
}

/** `true` iff the tenant is registered (door check helper). */
export function contextIsTenantRegistered(context: SecurityServiceContext, tenant: TenantId): boolean {
  return isTenantRegistered(stateOf(context).registry, tenant);
}
