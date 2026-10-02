/**
 * @tradrl/security — the security/tenancy/secrets/isolation CONTRACT
 * package (Work Order T044). THE L12/L20 SUBSTRATE: tenancy, secrets
 * opacity, untrusted-workload isolation and the security audit chain,
 * all enforced in code ("safety outside prompts", L20).
 *
 * Spec anchors — spec/SECURITY.md (the T044 charter, every section):
 * trust zones, untrusted workloads, execution, secrets, tenant
 * isolation, LLM security, audit; spec/ARCHITECTURE-LOCK.md L12
 * ("customer data, memory, trajectories and credentials are isolated"),
 * L20 ("safety outside prompts"), L9 (reproducible lineage);
 * spec/REQUIREMENTS.md R25 (tenant-isolated Firm Brain substrate), R42
 * (export/import without customer leakage); PROJECT-STATE invariant 8
 * ("Tenant data is isolated").
 *
 * Public API:
 *   - Structural primitives — the shared contract vocabulary (branding,
 *     hand-rolled guards, deep-freeze discipline, JSON model, canonical
 *     JSON, stable FNV-1a digests, TimestampMs) mirrored from
 *     @tradrl/execution-authority (T040, itself the T019 mirror)
 *     law-for-law.
 *   - Ids — the identity spaces owned here (the credential ENVELOPE id
 *     — the referent of T019/T040's 'cred:' refs; the workload
 *     isolation descriptor; the security audit record; the tenant
 *     registration; the usage event; the episode admission; the export
 *     bundle) plus the opaque cross-lane mirrors (tenant, project,
 *     strategy spec, venue, instrument, credential ref, authority scope
 *     ref, authority grant id, gateway audit record id, and T005's
 *     environment/episode/seed/world spaces).
 *   - `Scope` / `ScopedRecord` / `sameScope` / `requireSameScope` — the
 *     L12 tenancy primitives: every record carries its tenant+project
 *     scope, and cross-tenant access is the TYPED `cross_tenant_access`
 *     error (never a filter).
 *   - The credential-opacity trip wire — `credentialValueViolations`
 *     (the T019/T040 mirror): a credential VALUE anywhere in ANY record
 *     this lane emits is the typed `credential_value_present` error.
 *   - `CredentialEnvelope` — the secrets contract: a secret is
 *     referenced by id+version, NEVER carried in plaintext in any
 *     record, log or audit line; possession fingerprints; the
 *     append-only rotation/revocation version chain; injection receipts
 *     (the runtime-boundary facts, value-free).
 *   - The authority-grant structural mirror — T040's
 *     `AuthorityGrantRecord` shapes, guards, content addressing,
 *     validity-window predicate and collect-all validation, mirrored
 *     law-for-law (the interop trip wire proves a REAL T040 grant IS
 *     this record).
 *   - The environment-spec structural mirror — T005's
 *     `EnvironmentSpec` shapes, guards, canonical JSON and deterministic
 *     episode-id derivation, mirrored exactly (the interop trip wire
 *     pins byte-parity with the REAL T005 functions).
 *   - `UntrustedContent` — the LLM-security tagging contracts (L20):
 *     market/news/retrieved/user content is untrusted input, and
 *     `authorityActionFromContent` REFUSES every authority-affecting
 *     action with the typed `untrusted_content_escalation` error.
 *   - Redaction/scrubbing — `redactCredentialValues` / `scrubForLog` /
 *     `assertNoCredentialMaterial`: deterministic, VERIFIED scrubs plus
 *     the standalone gate.
 *   - `WorkloadIsolationDescriptor` / `EpisodeAdmissionRecord` — the
 *     untrusted-workload isolation contracts: an episode is admissible
 *     ONLY under a descriptor (default-deny egress; credential access
 *     never yields values); the admission record binds the descriptor
 *     to the episode's derived id.
 *   - `SecurityAuditRecord` / `SecurityAuditTrail` — the audit chain
 *     (who/what acted, scope, action class, decision), append-only and
 *     chain-verified per T040's audit discipline, composing with T040's
 *     gateway audit chain via OPAQUE refs only (the complement law).
 *
 * Zero runtime dependencies; types, schemas and pure functions only. No
 * ambient clock (`Date.now()` never appears) and no ambient randomness.
 * Cross-lane shapes (T005/T019/T040) are STRUCTURAL MIRRORS (D-003/D-004)
 * — never imports; src/interop.test.ts is the drift trip wire. The
 * enforcement SERVICE (services/security) consumes this package via
 * relative source imports (the execution-gateway precedent).
 */

// Errors and results
export type { SecurityErrorCode, SecurityError, SecurityResult } from './errors';
export { errorOf, fail, failures, ok, missingField, invalidField, invalidType, isSecurityError } from './errors';

// Structural primitives
export type { Brand, Mutable, JsonValue, JsonObject, TimestampMs } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isMemberOf,
  isArrayOf,
  deepFreeze,
  isDeeplyFrozen,
  isJsonValue,
  isJsonObject,
  canonicalJson,
  fnv1a32Hex,
  fnv1a32Int,
  stableDigest,
  isDigest,
  MIN_TIMESTAMP_MS,
  MAX_TIMESTAMP_MS,
  isTimestampMs,
} from './primitives';

// Ids and opaque cross-lane references
export type {
  CredentialEnvelopeId,
  IsolationDescriptorId,
  SecurityAuditRecordId,
  TenantRegistrationId,
  UsageEventId,
  EpisodeAdmissionId,
  ExportBundleId,
  TenantId,
  ProjectId,
  StrategySpecId,
  VenueId,
  InstrumentId,
  CredentialRef,
  AuthorityScopeRef,
  AuthorityGrantId,
  GatewayAuditRecordId,
  EnvironmentId,
  EpisodeId,
  Seed,
  WorldId,
  CredentialVersionRef,
  GrantVersionRef,
  StrategyVersionRefMirror,
} from './ids';
export {
  isCredentialEnvelopeId,
  isIsolationDescriptorId,
  isSecurityAuditRecordId,
  isTenantRegistrationId,
  isUsageEventId,
  isEpisodeAdmissionId,
  isExportBundleId,
  isTenantId,
  isProjectId,
  isStrategySpecId,
  isVenueId,
  isInstrumentId,
  isCredentialRef,
  isAuthorityScopeRef,
  isAuthorityGrantId,
  isGatewayAuditRecordId,
  isEnvironmentId,
  isEpisodeId,
  isSeed,
  isWorldId,
  isCredentialVersionRef,
  isGrantVersionRef,
  isStrategyVersionRefMirror,
  mintCredentialEnvelopeId,
  mintIsolationDescriptorId,
  mintSecurityAuditRecordId,
  mintTenantRegistrationId,
  mintUsageEventId,
  mintEpisodeAdmissionId,
  mintExportBundleId,
} from './ids';

// The tenancy scope (L12 substrate)
export type { Scope, ScopedRecord } from './scope';
export {
  isScope,
  validateScope,
  isScopedRecord,
  scopeOf,
  scopeKey,
  sameScope,
  crossTenantAccess,
  requireSameScope,
  isRecordId,
} from './scope';

// The credential-opacity trip wire
export { CREDENTIAL_VALUE_KEYS, isCredentialValueKey, credentialValueViolations } from './credentials';

// The credential envelope (the secrets contract)
export type {
  CredentialEnvelope,
  CredentialEnvelopeStatus,
  CredentialKind,
  CredentialInjectionReceipt,
  CredentialResolutionVerdict,
  CredentialRuntimeRef,
} from './credential-envelope';
export {
  CREDENTIAL_ENVELOPE_STATUSES,
  credentialFingerprint,
  isCredentialEnvelope,
  envelopeContentTree,
  canonicalEnvelopeJson,
  validateCredentialEnvelope,
  mintCredentialEnvelope,
  reviseCredentialEnvelope,
  credentialStatus,
  isCredentialInjectionReceipt,
  validateCredentialInjectionReceipt,
  credentialInjectionReceipt,
  receiptScope,
  envelopeIdOfRef,
} from './credential-envelope';

// The authority-grant structural mirror (T040)
export type {
  RevocationRecord,
  GrantRateBudget,
  GrantCredentialBinding,
  AuthorityGrantRecord,
  GrantStatusRefusal,
} from './grant-mirror';
export {
  isRevocationRecord,
  isGrantRateBudget,
  isGrantCredentialBinding,
  isAuthorityGrantRecord,
  grantContentTree,
  canonicalGrantJson,
  validateAuthorityGrant,
  mintAuthorityGrant,
  grantStatus,
} from './grant-mirror';

// The environment-spec structural mirror (T005)
export type {
  FidelityMode,
  InformationPolicy,
  ClockConfig,
  WorldRef,
  EnvironmentProfile,
  EnvironmentSpec,
} from './spec-mirror';
export {
  FIDELITY_MODES,
  isFidelityMode,
  isInformationPolicy,
  isClockConfig,
  isWorldRef,
  isEnvironmentProfile,
  isEnvironmentSpec,
  canonicalSpecJson,
  deriveEpisodeId,
  freezeSpec,
} from './spec-mirror';

// Untrusted-content tagging (L20 — LLM security)
export type {
  UntrustedContentKind,
  UntrustedContentTag,
  UntrustedContent,
  ProvenanceMark,
  UntrustedEscalationRefusal,
  AuthorityActionRecord,
} from './untrusted';
export {
  UNTRUSTED_CONTENT_KINDS,
  AUTHORITY_AFFECTING_ACTIONS,
  PROVENANCE_MARKS,
  isUntrustedContentKind,
  isUntrustedContentTag,
  isUntrustedContent,
  tagUntrusted,
  validateUntrustedContent,
  isAuthorityAffectingAction,
  isProvenanceMark,
  mayProvenanceGrantAuthority,
  isUntrustedEscalationRefusal,
  isAuthorityActionRecord,
  authorityActionFromContent,
  authorizeAuthorityAction,
  untrustedEscalationViolations,
  assertRecordSafeFromUntrustedSources,
} from './untrusted';

// Redaction and scrubbing
export type { RedactionReport, ScrubbedTree } from './redaction';
export {
  REDACTED_CREDENTIAL_MARKER,
  redactCredentialValues,
  scrubForLog,
  assertNoCredentialMaterial,
  isFingerprint,
} from './redaction';

// The workload isolation contracts
export type {
  WorkloadKind,
  EgressPolicy,
  FilesystemPolicy,
  CredentialAccessPolicy,
  WorkloadIsolationDescriptor,
  EpisodeAdmissionRecord,
} from './isolation';
export {
  WORKLOAD_KINDS,
  EGRESS_POLICIES,
  FILESYSTEM_POLICIES,
  CREDENTIAL_ACCESS_POLICIES,
  isWorkloadKind,
  isEgressPolicy,
  isFilesystemPolicy,
  isCredentialAccessPolicy,
  isWorkloadIsolationDescriptor,
  descriptorContentTree,
  canonicalDescriptorJson,
  validateWorkloadIsolationDescriptor,
  mintIsolationDescriptor,
  isEpisodeAdmissionRecord,
  admissionContentTree,
  canonicalAdmissionJson,
  mintEpisodeAdmission,
} from './isolation';

// The security audit trail (SECURITY.md Audit, chain-verified)
export type {
  SecurityAuditActionClass,
  SecurityAuditActor,
  SecurityAuditSubject,
  GatewayAuditObjectRef,
  SecurityAuditRecord,
  SecurityAuditTrail,
} from './security-audit';
export {
  SECURITY_AUDIT_ACTION_CLASSES,
  SECURITY_AUDIT_ACTOR_KINDS,
  isSecurityAuditActionClass,
  isSecurityAuditActor,
  isSecurityAuditSubject,
  isGatewayAuditObjectRef,
  gatewayAuditObjectRef,
  isSecurityAuditRecord,
  isSecurityAuditTrail,
  startSecurityAuditTrail,
  appendSecurityAuditRecord,
  securityAuditRecordAt,
  verifySecurityAuditChain,
  validateSecurityAuditTrail,
  isDetailObject,
} from './security-audit';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/security',
  owner: 'T044',
  status: 'implemented',
  concepts: [
    'Scope',
    'ScopedRecord',
    'cross_tenant_access',
    'credentialValueViolations',
    'CredentialEnvelope',
    'CredentialInjectionReceipt',
    'AuthorityGrantRecord (mirror)',
    'EnvironmentSpec (mirror)',
    'UntrustedContent',
    'untrusted_content_escalation',
    'WorkloadIsolationDescriptor',
    'EpisodeAdmissionRecord',
    'SecurityAuditRecord',
    'SecurityAuditTrail',
  ],
} as const;
