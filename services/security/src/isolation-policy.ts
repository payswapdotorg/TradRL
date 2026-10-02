/**
 * @tradrl/security-service — the untrusted workload isolation policy
 * (T005 episode admission).
 *
 * THE LAW (spec/SECURITY.md Untrusted workloads — VERBATIM: "User-
 * provided executable or research workloads are untrusted and require
 * isolation."; spec/SECURITY.md Trust zones: "... -> isolated
 * research/environment workers -> ..."; the T044 Work Order: "untrusted
 * workload isolation policy (T005 episode admission requires an
 * isolation descriptor)").
 *
 * THE MODEL: an episode (T005's isolated workload unit — the spec that
 * fully determines one run) is admissible ONLY when:
 *
 *   1. the acting scope is REGISTERED in the tenant isolation registry
 *      (`tenant_missing` otherwise);
 *   2. an isolation descriptor is PRESENT (`isolation_violation`
 *      otherwise — the named error of the charter: admission without a
 *      descriptor is inexpressible);
 *   3. the descriptor's scope IS the acting scope (`cross_tenant_access`
 *      — a workload never runs under a borrowed descriptor);
 *   4. the descriptor is guard-valid and admits EPISODES;
 *   5. the spec is a structurally valid T005 EnvironmentSpec (the
 *      mirror guard).
 *
 * On success an {@link EpisodeAdmissionRecord} is minted (content-
 * addressed; binds the descriptor to the spec-derived episode id) and
 * returned for the audit trail. Every refusal is a typed record
 * (`isolation_violation` / `cross_tenant_access` / `tenant_missing` /
 * `invalid_type`) — never an exception.
 *
 * The policy also exposes the SANDBOX ECHO check the runtime enforces:
 * `runtimeMayUseCredentials` answers whether an admitted workload's
 * descriptor permits envelope-reference access (values are NEVER
 * workload-visible — the descriptor floor is 'envelope_refs_only').
 */

import {
  isEnvironmentSpec,
  isWorkloadIsolationDescriptor,
  mintEpisodeAdmission,
  type EpisodeAdmissionRecord,
  type EnvironmentSpec,
  type Scope,
  type TimestampMs,
  type WorkloadIsolationDescriptor,
} from '../../../packages/security/src/index';
import { isScopeRegistered, type TenantIsolationRegistry } from './registry';

// ---------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------

/** The typed admission refusal (a record — the T019/T040 law). */
export type EpisodeAdmissionRefusal =
  | { readonly kind: 'tenant_missing'; readonly actorScope: string }
  | { readonly kind: 'isolation_violation'; readonly actorScope: string; readonly episodeId: string | null }
  | { readonly kind: 'cross_tenant_access'; readonly actorScope: string; readonly descriptorScope: string }
  | { readonly kind: 'invalid_type'; readonly detail: string };

/** The admission outcome. */
export type EpisodeAdmission =
  | { readonly ok: true; readonly admission: EpisodeAdmissionRecord }
  | { readonly ok: false; readonly refusal: EpisodeAdmissionRefusal; readonly errors: readonly { readonly code: string; readonly message: string }[] };

/**
 * Admit one episode under one isolation descriptor — the T005 episode
 * admission chokepoint. See the module header for the five laws. Pure
 * with respect to the registry (registration is a prerequisite, not a
 * side effect); the minted record is returned, NOT stored (the caller —
 * the security context — stores it on the 'trajectories' surface and
 * audits it).
 */
export function admitEpisode(
  registry: TenantIsolationRegistry,
  request: {
    readonly scope: Scope;
    readonly spec: EnvironmentSpec;
    readonly descriptor: WorkloadIsolationDescriptor | null;
    readonly admittedBy: string;
    readonly admittedAt: TimestampMs;
  },
): EpisodeAdmission {
  const actorScope = `${request.scope.tenant}/${request.scope.project}`;
  if (!isScopeRegistered(registry, request.scope)) {
    return refused(
      { kind: 'tenant_missing', actorScope },
      'tenant_missing',
      `scope ${actorScope} is not registered — untrusted workloads run only for registered scopes (L12)`,
    );
  }
  if (request.descriptor === null || request.descriptor === undefined) {
    return refused(
      { kind: 'isolation_violation', actorScope, episodeId: null },
      'isolation_violation',
      `episode admission for ${actorScope} carries NO isolation descriptor — user-provided executable or research workloads are untrusted and require isolation (spec/SECURITY.md Untrusted workloads); admission is refused`,
    );
  }
  if (!isWorkloadIsolationDescriptor(request.descriptor)) {
    return refused(
      { kind: 'isolation_violation', actorScope, episodeId: null },
      'isolation_violation',
      `the isolation descriptor for ${actorScope} is structurally invalid — a workload cannot run under an unvalidated sandbox declaration`,
    );
  }
  if (request.descriptor.tenant !== request.scope.tenant || request.descriptor.project !== request.scope.project) {
    return refused(
      { kind: 'cross_tenant_access', actorScope, descriptorScope: `${request.descriptor.tenant}/${request.descriptor.project}` },
      'cross_tenant_access',
      `the descriptor belongs to ${request.descriptor.tenant}/${request.descriptor.project} while the workload runs for ${actorScope} — workloads never run under a borrowed descriptor (L12)`,
    );
  }
  if (request.descriptor.workloadKind !== 'episode') {
    return refused(
      { kind: 'isolation_violation', actorScope, episodeId: null },
      'isolation_violation',
      `the descriptor admits '${request.descriptor.workloadKind}' workloads but this admission is an episode — descriptor and workload kind must agree`,
    );
  }
  if (!isEnvironmentSpec(request.spec)) {
    return refused(
      { kind: 'invalid_type', detail: 'the environment spec fails the T005 mirror guard (fidelity/clock/policy coherence)' },
      'invalid_type',
      'the episode spec is not a structurally valid EnvironmentSpec (T005 mirror)',
    );
  }
  const minted = mintEpisodeAdmission(request.spec, request.descriptor, request.admittedBy, request.admittedAt);
  if (!minted.ok) {
    return refused(
      { kind: 'invalid_type', detail: 'the admission record failed its own minting laws' },
      minted.errors[0]!.code,
      minted.errors[0]!.message,
    );
  }
  return { ok: true, admission: minted.value };
}

function refused(refusalRecord: EpisodeAdmissionRefusal, code: string, message: string): EpisodeAdmission {
  return { ok: false, refusal: Object.freeze(refusalRecord), errors: Object.freeze([{ code, message }]) };
}

// ---------------------------------------------------------------------------
// The sandbox echo checks (what the runtime enforces against the descriptor)
// ---------------------------------------------------------------------------

/** `true` iff the admitted workload may see credential ENVELOPE references (values are never workload-visible). */
export function runtimeMaySeeEnvelopeRefs(admission: EpisodeAdmissionRecord): boolean {
  return admission.constraints.credentialAccess === 'envelope_refs_only';
}

/** The egress decision for a host, from the admission's echoed constraints (default-deny). */
export function runtimeEgressAllowed(admission: EpisodeAdmissionRecord, host: string, networkAllowlist: readonly string[]): boolean {
  if (admission.constraints.egress === 'none') return false;
  return networkAllowlist.includes(host);
}
